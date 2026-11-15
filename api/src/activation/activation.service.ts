import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AppError, rateLimited } from '../common/errors';
import { AppConfig, CONFIG } from '../config/config';
import { DbService } from '../db/db.service';
import { NetworkService } from '../network/network.service';
import { RateLimitService, RateRule } from '../ratelimit/rate-limit.service';
import { RedisService } from '../redis/redis.service';
import { CodeKeyring } from './code-keyring.service';
import { hasValidChecksum, normalizeCode } from './code-format';

export interface RedeemResult {
  enrollment: { course_id: string; status: string; expires_at: Date | null };
  grant: { id: string; is_extension: boolean };
}

type FailReason = 'not_found' | 'email_mismatch' | 'expired' | 'unusable' | 'revoked';
type Outcome =
  | { t: 'ok'; result: RedeemResult; codeId: string }
  | { t: 'own' }
  | { t: 'fail'; reason: FailReason; codeId?: string }
  | { t: 'business'; status: number; code: string; message: string };

/** Lỗi nghiệp vụ do grant_access() (migration 002) → mã lỗi API. Chỉ xảy ra SAU khi mã và email đã được xác thực. */
const BUSINESS: Record<string, { status: number; code: string; message: string }> = {
  NO_ENROLLMENT_TO_EXTEND: { status: 409, code: 'NO_ENROLLMENT_TO_EXTEND', message: 'Đây là mã gia hạn nhưng bạn chưa có khóa học tương ứng. Hãy kích hoạt khóa học trước.' },
  ALREADY_LIFETIME: { status: 409, code: 'ALREADY_LIFETIME', message: 'Khóa học này của bạn đã có thời hạn vĩnh viễn, không cần gia hạn. Mã chưa bị sử dụng.' },
};
const GRANT_FAIL = new Set(['CODE_NOT_REDEEMABLE', 'CODE_EXPIRED', 'COURSE_MISMATCH']);

const GENERIC = 'Mã không hợp lệ hoặc không thể sử dụng. Nếu bạn tin đây là lỗi, hãy liên hệ trung tâm.';

@Injectable()
export class ActivationService {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly rl: RateLimitService,
    private readonly network: NetworkService,
    private readonly audit: AuditService,
    private readonly keyring: CodeKeyring,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * Kích hoạt / gia hạn bằng mã (ARCHITECTURE §2.3, ADR-002).
   *  1. Rate limit chỉ đếm LẦN THẤT BẠI (theo user và theo IP; IP của trung tâm được nới).
   *  2. Sai checksum → 422, không chạm DB, không tính vào bộ đếm.
   *  3. Transaction: khóa hàng mã (FOR UPDATE) → kiểm tra → grant_access() (đánh dấu mã, tạo/gia hạn enrollment, ghi sổ cái).
   *  4. Mọi lý do thất bại liên quan tới mã đều trả CÙNG một phản hồi 404; lý do thật chỉ nằm trong audit_logs.
   */
  async redeem(userId: string, rawCode: string, ip: string): Promise<RedeemResult> {
    const u = (await this.db.query<{ email: string | null; email_verified: boolean; status: string; is_managed: boolean }>(
      'SELECT email, email_verified, status, is_managed FROM users WHERE id = $1', [userId])).rows[0];
    if (!u || u.status === 'locked') throw new AppError(403, 'ACCOUNT_INACTIVE', 'Tài khoản đang bị khóa. Vui lòng liên hệ trung tâm.');
    // Kiểm tra email TRƯỚC trạng thái "pending_verification" để người dùng nhận đúng chỉ dẫn.
    // Tài khoản trẻ em do phụ huynh quản lý không có email riêng: đối chiếu email phụ huynh ở redeemTx.
    if (!u.is_managed && !u.email_verified) throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Hãy xác minh email trước khi kích hoạt mã');

    const mult = (await this.network.isTrusted(ip)) ? this.cfg.RL_TRUSTED_MULTIPLIER : 1;
    const rules: RateRule[] = [
      { key: `act:fail:user:${userId}`, limit: this.cfg.ACT_FAIL_USER_LIMIT, windowMs: 15 * 60_000 },
      { key: `act:fail:ip:${ip}`, limit: this.cfg.ACT_FAIL_IP_LIMIT * mult, windowMs: 60 * 60_000 },
    ];
    await this.rl.enforce(rules);

    const normalized = normalizeCode(rawCode);
    if (!normalized || !hasValidChecksum(normalized)) {
      throw new AppError(422, 'CODE_FORMAT_INVALID', 'Mã có vẻ bị gõ sai. Hãy kiểm tra lại từng ký tự.');
    }

    const out = await this.db.tx<Outcome>((c) => this.redeemTx(c, userId, u, normalized));

    switch (out.t) {
      case 'ok':
        await this.redis.client.del(`access:${userId}:${out.result.enrollment.course_id}`);
        await this.audit.record({
          actorId: userId, action: 'code.redeem', entity: 'activation_code', entityId: out.codeId, ip,
          meta: { course_id: out.result.enrollment.course_id, grant_id: out.result.grant.id, is_extension: out.result.grant.is_extension },
        });
        return out.result;
      case 'own':
        throw new AppError(409, 'ALREADY_REDEEMED_BY_YOU', 'Bạn đã sử dụng mã này rồi.');
      case 'business':
        throw new AppError(out.status, out.code, out.message);
      case 'fail':
        await this.rl.hitAll(rules);
        await this.audit.record({
          actorId: userId, action: out.reason === 'email_mismatch' ? 'code.redeem_email_mismatch' : 'code.redeem_failed',
          entity: 'activation_code', entityId: out.codeId ?? null, ip, meta: { reason: out.reason },
        });
        throw new AppError(404, 'CODE_INVALID', GENERIC);
    }
  }

  private async redeemTx(
    c: import('pg').PoolClient, userId: string,
    u: { email: string | null; is_managed: boolean }, normalized: string,
  ): Promise<Outcome> {
    const found = await c.query<{
      id: string; course_id: string; status: string; bound_email: string | null; redeemed_by: string | null; expires_at: Date | null;
    }>(
      `SELECT id, course_id, status, bound_email, redeemed_by, expires_at
         FROM activation_codes WHERE code_hmac = ANY($1::bytea[]) FOR UPDATE`, [this.keyring.candidates(normalized)]);
    const code = found.rows[0];
    if (!code) return { t: 'fail', reason: 'not_found' };

    if (code.status === 'used' && code.redeemed_by === userId) return { t: 'own' };
    if (code.status === 'revoked') return { t: 'fail', reason: 'revoked', codeId: code.id };
    if (code.status !== 'unused') return { t: 'fail', reason: 'unusable', codeId: code.id };
    if (code.expires_at && code.expires_at.getTime() < Date.now()) {
      await c.query(`UPDATE activation_codes SET status = 'expired' WHERE id = $1`, [code.id]); // được COMMIT cùng giao dịch
      return { t: 'fail', reason: 'expired', codeId: code.id };
    }

    if (code.bound_email) {
      const allowed = new Set<string>();
      if (u.email) allowed.add(u.email.toLowerCase());
      if (u.is_managed) {
        const g = await c.query<{ email: string }>(
          `SELECT g.email FROM guardian_links l JOIN users g ON g.id = l.guardian_id
            WHERE l.child_id = $1 AND g.email IS NOT NULL AND g.email_verified`, [userId]);
        g.rows.forEach((r) => allowed.add(r.email.toLowerCase()));
      }
      if (!allowed.has(code.bound_email.toLowerCase())) return { t: 'fail', reason: 'email_mismatch', codeId: code.id };
    }

    await c.query('SAVEPOINT sp_grant');
    try {
      const g = await c.query<{ id: string }>(`SELECT grant_access($1::uuid, $2::uuid, 'code', $3::uuid) AS id`, [userId, code.course_id, code.id]);
      const r = await c.query<{ course_id: string; status: string; expires_at: Date | null; is_extension: boolean }>(
        `SELECT e.course_id, e.status, e.expires_at, g.is_extension
           FROM enrollment_grants g JOIN enrollments e ON e.id = g.enrollment_id WHERE g.id = $1`, [g.rows[0].id]);
      return {
        t: 'ok', codeId: code.id,
        result: {
          enrollment: { course_id: r.rows[0].course_id, status: r.rows[0].status, expires_at: r.rows[0].expires_at },
          grant: { id: g.rows[0].id, is_extension: r.rows[0].is_extension },
        },
      };
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT sp_grant'); // hoàn tác riêng grant_access; giữ giao dịch hợp lệ
      const msg = (e as { message?: string }).message ?? '';
      if (BUSINESS[msg]) return { t: 'business', ...BUSINESS[msg] };
      if (GRANT_FAIL.has(msg)) return { t: 'fail', reason: 'unusable', codeId: code.id };
      throw e;
    }
  }
}
