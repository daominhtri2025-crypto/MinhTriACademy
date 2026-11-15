import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { AppConfig, CONFIG } from '../config/config';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { MailService } from '../mail/mail.service';
import { NetworkService } from '../network/network.service';
import { RateLimitService, RateRule } from '../ratelimit/rate-limit.service';
import { randomToken, sha256, sha256Hex } from '../security/crypto.util';
import { PasswordService } from '../security/password.service';
import { DevicesService, DeviceSummary } from './devices.service';
import { LoginDto, RegisterDto } from './dto';
import { TokensService } from './tokens.service';

export interface ClientCtx { ip: string; userAgent: string }

interface UserRow {
  id: string; email: string | null; password_hash: string | null; full_name: string; role: string;
  status: string; email_verified: boolean; device_quota: number;
}

export interface LoginResult {
  accessToken: string; expiresIn: number; refreshToken: string; kiosk: boolean;
  user: { id: string; email: string | null; full_name: string; role: string; email_verified: boolean };
}
export interface RefreshResult { accessToken: string; expiresIn: number; refreshToken?: string }

const MIN = 60_000;
const HOUR = 60 * MIN;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly rl: RateLimitService,
    private readonly network: NetworkService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ───────────────────────── Đăng ký & xác minh email ─────────────────────────

  /** Luôn phản hồi như nhau dù email đã tồn tại hay chưa (chống dò email). */
  async register(dto: RegisterDto, ctx: ClientCtx): Promise<void> {
    const rule: RateRule = { key: `reg:ip:${ctx.ip}`, limit: this.cfg.REGISTER_IP_LIMIT, windowMs: HOUR };
    await this.rl.enforce([rule]);
    await this.rl.hit(rule.key, rule.windowMs); // đếm mọi lần thử, không chỉ thất bại

    this.passwords.assertPolicy(dto.password, dto.email);
    if (await this.passwords.isBreached(dto.password)) {
      throw new AppError(422, 'PASSWORD_BREACHED', 'Mật khẩu này đã xuất hiện trong dữ liệu bị lộ. Hãy chọn mật khẩu khác.');
    }
    const age = dto.birth_year ? new Date().getUTCFullYear() - dto.birth_year : null;
    if (age !== null && age < this.cfg.MINOR_AGE_THRESHOLD && !dto.guardian_email) {
      throw new AppError(422, 'GUARDIAN_REQUIRED', 'Học viên chưa đủ tuổi cần có email của phụ huynh/người giám hộ');
    }

    const hash = await this.passwords.hash(dto.password); // tính trước để thời gian phản hồi không phân biệt email mới/cũ
    const ins = await this.db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, birth_year, guardian_email)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [dto.email, hash, dto.full_name, dto.birth_year ?? null, dto.guardian_email ?? null]);

    if (ins.rowCount) {
      await this.issueVerification(ins.rows[0].id, dto.email);
      await this.audit.record({ actorId: ins.rows[0].id, action: 'user.register', entity: 'user', entityId: ins.rows[0].id, ip: ctx.ip });
    } else {
      await this.mail.send({
        to: dto.email,
        subject: 'Minh Trí Academy — email này đã có tài khoản',
        text: 'Có người vừa dùng email này để đăng ký. Nếu là bạn, hãy đăng nhập hoặc dùng "Quên mật khẩu". Nếu không, bạn có thể bỏ qua thư này.',
      });
    }
  }

  async verifyEmail(token: string): Promise<void> {
    const ok = await this.db.tx(async (c) => {
      const t = await c.query<{ user_id: string }>(
        `UPDATE auth_tokens SET used_at = now()
          WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
        [sha256(token)]);
      if (!t.rowCount) return null;
      await c.query(
        `UPDATE users SET email_verified = true,
                status = CASE WHEN status = 'pending_verification' THEN 'active'::user_status ELSE status END
          WHERE id = $1`, [t.rows[0].user_id]);
      return t.rows[0].user_id;
    });
    if (!ok) throw new AppError(400, 'TOKEN_INVALID', 'Liên kết xác minh không hợp lệ hoặc đã hết hạn');
    await this.audit.record({ actorId: ok, action: 'user.email_verified', entity: 'user', entityId: ok });
  }

  async resendVerification(email: string, ctx: ClientCtx): Promise<void> {
    const rules: RateRule[] = [
      { key: `verify:email:${email}`, limit: 3, windowMs: HOUR },
      { key: `verify:ip:${ctx.ip}`, limit: 20, windowMs: HOUR },
    ];
    await this.rl.enforce(rules);
    await this.rl.hitAll(rules);
    const u = await this.db.query<{ id: string }>('SELECT id FROM users WHERE email = $1 AND NOT email_verified', [email]);
    if (u.rowCount) await this.issueVerification(u.rows[0].id, email);
  }

  private async issueVerification(userId: string, email: string): Promise<void> {
    const token = randomToken(32);
    await this.db.query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, 'verify_email', $2, now() + interval '24 hours')`,
      [userId, sha256(token)]);
    await this.mail.send({
      to: email,
      subject: 'Xác minh email — Minh Trí Academy',
      text: `Mở liên kết sau để xác minh email (hiệu lực 24 giờ):\n${this.cfg.WEB_BASE_URL}/verify-email?token=${token}`,
    });
  }

  // ───────────────────────── Đăng nhập ─────────────────────────

  async login(dto: LoginDto, ctx: ClientCtx, deviceCookie: string): Promise<LoginResult> {
    const mult = (await this.network.isTrusted(ctx.ip)) ? this.cfg.RL_TRUSTED_MULTIPLIER : 1;
    const rules: RateRule[] = [
      { key: `login:fail:email:${dto.email}`, limit: this.cfg.LOGIN_FAIL_EMAIL_LIMIT, windowMs: 15 * MIN },
      { key: `login:fail:ip:${ctx.ip}`, limit: this.cfg.LOGIN_FAIL_IP_LIMIT * mult, windowMs: 15 * MIN },
    ];
    await this.rl.enforce(rules);

    const user = (await this.db.query<UserRow>(
      `SELECT id, email, password_hash, full_name, role, status, email_verified, device_quota FROM users WHERE email = $1`,
      [dto.email])).rows[0];

    let ok = false;
    if (user?.password_hash) ok = await this.passwords.verify(user.password_hash, dto.password);
    else await this.passwords.verifyDummy(dto.password);

    if (!ok) {
      await this.rl.hitAll(rules); // chỉ đếm lần THẤT BẠI
      await this.audit.record({ actorId: user?.id ?? null, action: 'auth.login_failed', entity: 'user', entityId: user?.id ?? null, ip: ctx.ip });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng');
    }
    if (user.status === 'locked') throw new AppError(403, 'ACCOUNT_LOCKED', 'Tài khoản đang bị khóa. Vui lòng liên hệ trung tâm.');

    const result = await this.db.tx(async (c) => {
      await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [user.id]); // tuần tự hóa kiểm tra quota
      const dev = await this.devices.resolve(c, user, sha256Hex(deviceCookie), ctx.ip, ctx.userAgent);
      if (dev.limit) return { limit: true as const, devices: dev.devices };
      const session = await this.tokens.createSession(c, { userId: user.id, deviceId: dev.deviceId, ip: ctx.ip, userAgent: ctx.userAgent });
      return { limit: false as const, session, deviceId: dev.deviceId, kiosk: dev.kiosk };
    });

    if (result.limit) {
      await this.audit.record({ actorId: user.id, action: 'auth.device_limit', entity: 'user', entityId: user.id, ip: ctx.ip });
      throw new AppError(403, 'DEVICE_LIMIT_REACHED',
        'Tài khoản đã đạt số thiết bị tối đa. Hãy gỡ bớt một thiết bị để tiếp tục.',
        { challenge_token: this.tokens.signChallenge(user.id), devices: result.devices satisfies DeviceSummary[] });
    }

    await this.rl.reset(rules[0].key);
    const access = this.tokens.signAccess({ userId: user.id, role: user.role, familyId: result.session.familyId, deviceId: result.deviceId });
    await this.audit.record({ actorId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, ip: ctx.ip, meta: { kiosk: result.kiosk } });
    return {
      accessToken: access.token, expiresIn: access.expiresIn, refreshToken: result.session.raw, kiosk: result.kiosk,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, email_verified: user.email_verified },
    };
  }

  // ───────────────────────── Refresh (xoay vòng + phát hiện dùng lại) ─────────────────────────

  async refresh(raw: string | undefined, ctx: ClientCtx): Promise<RefreshResult> {
    if (!raw) throw new AppError(401, 'NO_REFRESH_TOKEN', 'Thiếu phiên đăng nhập');
    const hash = sha256Hex(raw);
    const graceMs = this.cfg.REFRESH_GRACE_SEC * 1000;

    type Out =
      | { t: 'ok'; userId: string; role: string; familyId: string; deviceId: string; refresh?: string }
      | { t: 'reused'; userId: string; familyId: string }
      | { t: 'invalid' };

    const out = await this.db.tx<Out>(async (c) => {
      const s = (await c.query<{
        id: string; user_id: string; device_id: string; family_id: string; expires_at: Date; family_expires_at: Date;
        revoked_at: Date | null; rotated_at: Date | null; replaced_by: string | null; role: string; user_status: string;
      }>(
        `SELECT s.id, s.user_id, s.device_id, s.family_id, s.expires_at, s.family_expires_at, s.revoked_at, s.rotated_at,
                s.replaced_by, u.role, u.status AS user_status
           FROM user_sessions s JOIN users u ON u.id = s.user_id
          WHERE s.refresh_hash = $1 FOR UPDATE OF s`, [hash])).rows[0];

      if (!s || s.revoked_at) return { t: 'invalid' };
      const now = Date.now();
      if (s.expires_at.getTime() < now || s.family_expires_at.getTime() < now) return { t: 'invalid' };

      const revokeFamily = (reason: string) => c.query(
        `UPDATE user_sessions SET revoked_at = now(), revoked_reason = $2 WHERE family_id = $1 AND revoked_at IS NULL`, [s.family_id, reason]);

      if (s.user_status === 'locked') { await revokeFamily('admin'); return { t: 'invalid' }; }

      if (s.rotated_at) {
        // Hai tab cùng refresh gần như đồng thời: tab đến sau mang token vừa bị xoay. Trong cửa sổ ân hạn, cookie
        // trình duyệt đã được tab đến trước cập nhật → chỉ cấp access token, KHÔNG phát refresh mới (tránh phân nhánh họ token).
        if (now - s.rotated_at.getTime() <= graceMs && s.replaced_by) {
          const succ = (await c.query<{ revoked_at: Date | null }>('SELECT revoked_at FROM user_sessions WHERE id = $1', [s.replaced_by])).rows[0];
          if (succ && !succ.revoked_at) return { t: 'ok', userId: s.user_id, role: s.role, familyId: s.family_id, deviceId: s.device_id };
          return { t: 'invalid' };
        }
        await revokeFamily('reuse_detected'); // token cũ bị dùng lại ngoài cửa sổ ân hạn ⇒ nghi bị sao chép
        return { t: 'reused', userId: s.user_id, familyId: s.family_id };
      }

      const dev = (await c.query<{ revoked_at: Date | null }>('SELECT revoked_at FROM user_devices WHERE id = $1', [s.device_id])).rows[0];
      if (!dev || dev.revoked_at) { await revokeFamily('device_revoked'); return { t: 'invalid' }; }

      const next = await this.tokens.createSession(c, {
        userId: s.user_id, deviceId: s.device_id, familyId: s.family_id, familyExpiresAt: s.family_expires_at,
        ip: ctx.ip, userAgent: ctx.userAgent,
      });
      await c.query('UPDATE user_sessions SET rotated_at = now(), replaced_by = $1 WHERE id = $2', [next.id, s.id]);
      return { t: 'ok', userId: s.user_id, role: s.role, familyId: s.family_id, deviceId: s.device_id, refresh: next.raw };
    });

    if (out.t === 'reused') {
      await this.tokens.markFamilyRevoked(out.familyId);
      await this.audit.record({ actorId: out.userId, action: 'auth.refresh_reuse_detected', entity: 'session_family', ip: ctx.ip, meta: { family_id: out.familyId } });
      throw new AppError(401, 'REFRESH_REUSED', 'Phiên đăng nhập không còn an toàn. Vui lòng đăng nhập lại.');
    }
    if (out.t === 'invalid') throw new AppError(401, 'INVALID_REFRESH', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');

    const access = this.tokens.signAccess({ userId: out.userId, role: out.role, familyId: out.familyId, deviceId: out.deviceId });
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: out.refresh };
  }

  async logout(raw: string | undefined): Promise<void> {
    if (!raw) return;
    const r = await this.db.query<{ family_id: string }>(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'logout'
        WHERE family_id = (SELECT family_id FROM user_sessions WHERE refresh_hash = $1) AND revoked_at IS NULL
        RETURNING family_id`, [sha256Hex(raw)]);
    if (r.rows[0]) await this.tokens.markFamilyRevoked(r.rows[0].family_id);
  }

  async me(userId: string) {
    const r = await this.db.query(
      'SELECT id, email, username, full_name, role, status, email_verified, is_managed, exp_total FROM users WHERE id = $1', [userId]);
    if (!r.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản');
    return r.rows[0];
  }
}
