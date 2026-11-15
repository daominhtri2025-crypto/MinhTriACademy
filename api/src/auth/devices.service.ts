import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AppError, rateLimited } from '../common/errors';
import { AppConfig, CONFIG } from '../config/config';
import { DbService } from '../db/db.service';
import { MailService } from '../mail/mail.service';
import { RateLimitService } from '../ratelimit/rate-limit.service';
import { RedisService } from '../redis/redis.service';
import { safeEqualHex, sha256Hex } from '../security/crypto.util';
import { TokensService } from './tokens.service';

export interface DeviceSummary { id: string; label: string | null; last_seen: Date }
export type DeviceResolution =
  | { limit: false; deviceId: string; kiosk: boolean }
  | { limit: true; devices: DeviceSummary[] };

interface DeviceRow { id: string; revoked_at: Date | null; institution_device_id: string | null }

/** "Chrome / Windows" từ User-Agent — chỉ để người dùng nhận ra thiết bị của mình, không phải fingerprint. */
export function deviceLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Không rõ';
  return `${browser} / ${os}`;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly rl: RateLimitService,
    private readonly mail: MailService,
    private readonly tokens: TokensService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * Xác định thiết bị khi đăng nhập (gọi trong transaction đã khóa hàng users).
   * Quota chỉ đếm thiết bị cá nhân; máy kiosk (do admin đăng ký, và IP đang thuộc mạng của trung tâm) được miễn.
   */
  async resolve(c: PoolClient, user: { id: string; device_quota: number }, cookieHash: string, ip: string, ua: string): Promise<DeviceResolution> {
    const existing = (await c.query<DeviceRow>(
      'SELECT id, revoked_at, institution_device_id FROM user_devices WHERE user_id = $1 AND device_cookie_hash = $2',
      [user.id, cookieHash])).rows[0];

    // Yếu tố 2 của kiosk: cookie thuộc máy do admin đăng ký VÀ IP hiện tại thuộc đúng mạng đó.
    const kiosk = (await c.query<{ id: string }>(
      `SELECT d.id FROM institution_devices d JOIN trusted_networks n ON n.id = d.network_id
        WHERE d.device_cookie_hash = $1 AND d.revoked_at IS NULL AND n.is_active AND $2::inet <<= n.cidr LIMIT 1`,
      [cookieHash, ip])).rows[0];
    const kioskId = kiosk?.id ?? null;

    // Thiết bị đã đăng ký còn hiệu lực: chỉ cần chạm vào. Riêng kiosk bị "dời" khỏi mạng trung tâm thì phải xét lại quota.
    if (existing && !existing.revoked_at && (existing.institution_device_id === null || kioskId)) {
      await c.query('UPDATE user_devices SET last_seen = now(), last_ip = $2 WHERE id = $1', [existing.id, ip]);
      return { limit: false, deviceId: existing.id, kiosk: existing.institution_device_id !== null };
    }

    if (!kioskId) {
      const used = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM user_devices
          WHERE user_id = $1 AND revoked_at IS NULL AND institution_device_id IS NULL AND id IS DISTINCT FROM $2::uuid`,
        [user.id, existing?.id ?? null]);
      if (Number(used.rows[0].n) >= user.device_quota) {
        const list = await c.query<DeviceSummary>(
          `SELECT id, label, last_seen FROM user_devices
            WHERE user_id = $1 AND revoked_at IS NULL AND institution_device_id IS NULL ORDER BY last_seen DESC`, [user.id]);
        return { limit: true, devices: list.rows };
      }
    }

    if (existing) {
      await c.query(
        'UPDATE user_devices SET revoked_at = NULL, institution_device_id = $2, last_seen = now(), last_ip = $3, label = $4 WHERE id = $1',
        [existing.id, kioskId, ip, deviceLabel(ua)]);
      return { limit: false, deviceId: existing.id, kiosk: kioskId !== null };
    }
    const ins = await c.query<{ id: string }>(
      `INSERT INTO user_devices (user_id, device_cookie_hash, label, first_ip, last_ip, institution_device_id)
       VALUES ($1, $2, $3, $4, $4, $5) RETURNING id`,
      [user.id, cookieHash, deviceLabel(ua), ip, kioskId]);
    return { limit: false, deviceId: ins.rows[0].id, kiosk: kioskId !== null };
  }

  async list(userId: string, currentDeviceId: string) {
    const r = await this.db.query(
      `SELECT id, label, last_seen, (institution_device_id IS NOT NULL) AS kiosk
         FROM user_devices WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen DESC`, [userId]);
    return r.rows.map((d) => ({ ...d, current: d.id === currentDeviceId }));
  }

  /** Thu hồi thiết bị + mọi phiên đăng nhập trên thiết bị đó (hiệu lực tức thời nhờ khóa Redis). */
  async revoke(userId: string, deviceIds: string[]): Promise<number> {
    const { count, families } = await this.db.tx(async (c) => {
      const d = await c.query<{ id: string }>(
        'UPDATE user_devices SET revoked_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND revoked_at IS NULL RETURNING id',
        [userId, deviceIds]);
      if (!d.rowCount) return { count: 0, families: [] as string[] };
      const s = await c.query<{ family_id: string }>(
        `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'device_revoked'
          WHERE device_id = ANY($1::uuid[]) AND revoked_at IS NULL RETURNING family_id`, [d.rows.map((x) => x.id)]);
      return { count: d.rowCount, families: [...new Set(s.rows.map((x) => x.family_id))] };
    });
    await Promise.all(families.map((f) => this.tokens.markFamilyRevoked(f)));
    return count;
  }

  // ── Thu hồi thiết bị khi chạm giới hạn: cần OTP gửi qua email (hoặc email phụ huynh với tài khoản trẻ em) ──
  async requestOtp(challengeToken: string): Promise<void> {
    const userId = this.tokens.verifyChallenge(challengeToken);
    const rule = { key: `otp:req:${userId}`, limit: 3, windowMs: 15 * 60_000 };
    await this.rl.enforce([rule]);
    await this.rl.hit(rule.key, rule.windowMs);

    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redis.client.set(`otp:dev:${userId}`, sha256Hex(otp), 'EX', this.cfg.DEVICE_OTP_TTL_SEC);
    await this.redis.client.del(`otp:att:${userId}`);
    for (const to of await this.recipients(userId)) {
      await this.mail.send({
        to,
        subject: 'Mã xác nhận gỡ thiết bị — Minh Trí Academy',
        text: `Mã xác nhận của bạn là ${otp}. Mã có hiệu lực ${Math.round(this.cfg.DEVICE_OTP_TTL_SEC / 60)} phút. Nếu bạn không yêu cầu, hãy bỏ qua thư này và đổi mật khẩu.`,
      });
    }
  }

  async revokeWithOtp(challengeToken: string, otp: string, deviceIds: string[]): Promise<number> {
    const userId = this.tokens.verifyChallenge(challengeToken);
    const attKey = `otp:att:${userId}`;
    const attempts = await this.redis.client.incr(attKey);
    if (attempts === 1) await this.redis.client.expire(attKey, this.cfg.DEVICE_OTP_TTL_SEC);
    if (attempts > 5) {
      await this.redis.client.del(`otp:dev:${userId}`); // quá 5 lần thử → hủy OTP, phải yêu cầu mã mới
      throw rateLimited(this.cfg.DEVICE_OTP_TTL_SEC);
    }
    const stored = await this.redis.client.get(`otp:dev:${userId}`);
    if (!stored || !safeEqualHex(stored, sha256Hex(otp))) throw new AppError(401, 'OTP_INVALID', 'Mã xác nhận không đúng hoặc đã hết hạn');
    await this.redis.client.del(`otp:dev:${userId}`, attKey);
    return this.revoke(userId, deviceIds);
  }

  /** Email nhận OTP: chính chủ; với tài khoản do phụ huynh quản lý (không có email) → email các phụ huynh. */
  private async recipients(userId: string): Promise<string[]> {
    const u = await this.db.query<{ email: string | null }>('SELECT email FROM users WHERE id = $1', [userId]);
    if (u.rows[0]?.email) return [u.rows[0].email];
    const g = await this.db.query<{ email: string }>(
      `SELECT g.email FROM guardian_links l JOIN users g ON g.id = l.guardian_id WHERE l.child_id = $1 AND g.email IS NOT NULL`, [userId]);
    return g.rows.map((r) => r.email);
  }
}
