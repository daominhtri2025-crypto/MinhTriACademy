import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PoolClient } from 'pg';
import { AppError } from '../common/errors';
import { AppConfig, CONFIG } from '../config/config';
import { RedisService } from '../redis/redis.service';
import { randomToken, sha256Hex } from '../security/crypto.util';

export interface AuthUser { id: string; role: string; familyId: string; deviceId: string }
export interface NewSession { id: string; familyId: string; raw: string; expiresAt: Date; familyExpiresAt: Date }

const DAY = 86_400_000;

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ── Access token (JWT HS256, 15') ──
  signAccess(u: { userId: string; role: string; familyId: string; deviceId: string }): { token: string; expiresIn: number } {
    const token = this.jwt.sign(
      { typ: 'access', role: u.role, fid: u.familyId, did: u.deviceId },
      { subject: u.userId, expiresIn: this.cfg.ACCESS_TTL_SEC },
    );
    return { token, expiresIn: this.cfg.ACCESS_TTL_SEC };
  }

  async verifyAccess(token: string): Promise<AuthUser> {
    let p: { typ?: string; sub?: string; role?: string; fid?: string; did?: string };
    try {
      p = this.jwt.verify(token);
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
    }
    if (p.typ !== 'access' || !p.sub || !p.fid || !p.did || !p.role) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
    }
    if (await this.isFamilyRevoked(p.fid)) throw new AppError(401, 'SESSION_REVOKED', 'Phiên đăng nhập đã bị thu hồi');
    return { id: p.sub, role: p.role, familyId: p.fid, deviceId: p.did };
  }

  // ── Challenge token: bước trung gian khi chạm giới hạn thiết bị (không dùng được như access token) ──
  signChallenge(userId: string): string {
    return this.jwt.sign({ typ: 'device_limit' }, { subject: userId, expiresIn: 600 });
  }

  verifyChallenge(token: string): string {
    try {
      const p = this.jwt.verify<{ typ?: string; sub?: string }>(token);
      if (p.typ === 'device_limit' && p.sub) return p.sub;
    } catch {
      /* rơi xuống lỗi chung */
    }
    throw new AppError(401, 'CHALLENGE_INVALID', 'Yêu cầu không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại.');
  }

  // ── Thu hồi tức thời: access token còn hạn vẫn bị chặn nhờ khóa Redis theo họ phiên ──
  async markFamilyRevoked(familyId: string): Promise<void> {
    await this.redis.client.set(`revoked:fid:${familyId}`, '1', 'EX', this.cfg.ACCESS_TTL_SEC + 60);
  }

  async isFamilyRevoked(familyId: string): Promise<boolean> {
    return (await this.redis.client.exists(`revoked:fid:${familyId}`)) === 1;
  }

  // ── Refresh token: opaque 256-bit, DB chỉ giữ SHA-256 ──
  async createSession(c: PoolClient, a: {
    userId: string; deviceId: string; ip: string; userAgent: string;
    familyId?: string; familyExpiresAt?: Date;
  }): Promise<NewSession> {
    const raw = randomToken(32);
    const now = Date.now();
    const familyExpiresAt = a.familyExpiresAt ?? new Date(now + this.cfg.REFRESH_FAMILY_MAX_DAYS * DAY);
    const expiresAt = new Date(Math.min(now + this.cfg.REFRESH_TTL_DAYS * DAY, familyExpiresAt.getTime()));
    const r = await c.query<{ id: string; family_id: string }>(
      `INSERT INTO user_sessions (user_id, device_id, family_id, refresh_hash, expires_at, family_expires_at, ip, user_agent)
       VALUES ($1, $2, COALESCE($3::uuid, gen_random_uuid()), $4, $5, $6, $7, $8)
       RETURNING id, family_id`,
      [a.userId, a.deviceId, a.familyId ?? null, sha256Hex(raw), expiresAt, familyExpiresAt, a.ip, a.userAgent || null],
    );
    return { id: r.rows[0].id, familyId: r.rows[0].family_id, raw, expiresAt, familyExpiresAt };
  }
}
