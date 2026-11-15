import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { generateCode } from '../src/activation/code-format';
import { CodeKeyring } from '../src/activation/code-keyring.service';
import { REFRESH_COOKIE } from '../src/auth/cookies';
import { AppConfig, loadConfig } from '../src/config/config';
import { DbService } from '../src/db/db.service';
import { MailService } from '../src/mail/mail.service';
import { NetworkService } from '../src/network/network.service';
import { RedisService } from '../src/redis/redis.service';
import { PasswordService } from '../src/security/password.service';
import { TokensService } from '../src/auth/tokens.service';

export const PASSWORD = 'correct horse battery staple';
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://mta_test:mta_test@localhost:5432/postgres';
export const TEST_DB_URL = (() => { const u = new URL(adminUrl); u.pathname = '/mta_api_test'; return u.toString(); })();
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/15';

export interface Ctx {
  app: INestApplication;
  cfg: AppConfig;
  http: ReturnType<INestApplication['getHttpServer']>;
  db: DbService;
  redis: RedisService;
  mail: MailService;
  network: NetworkService;
  tokens: TokensService;
  passwords: PasswordService;
  keyring: CodeKeyring;
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<Ctx> {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB_URL,
    REDIS_URL: TEST_REDIS_URL,
    JWT_ACCESS_SECRET: 'test-secret-'.repeat(5),
    ACTIVATION_PEPPERS: `2:${'a'.repeat(64)},1:${'b'.repeat(64)}`, // khóa 2 hiện hành, khóa 1 còn hiệu lực (xoay khóa)
    TRUST_PROXY: '1',                                              // cho phép giả lập IP bằng X-Forwarded-For
    REFRESH_GRACE_SEC: '1',
    ...overrides,
  } as NodeJS.ProcessEnv);
  const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(cfg)] }).compile();
  const app = mod.createNestApplication();
  configureApp(app, cfg);
  await app.init();
  return {
    app, cfg, http: app.getHttpServer(),
    db: app.get(DbService), redis: app.get(RedisService), mail: app.get(MailService),
    network: app.get(NetworkService), tokens: app.get(TokensService), passwords: app.get(PasswordService), keyring: app.get(CodeKeyring),
  };
}

/** Xóa sạch dữ liệu và bộ nhớ Redis giữa các test. */
export async function resetState(ctx: Ctx): Promise<void> {
  await ctx.db.query(`TRUNCATE users, courses, trusted_networks, audit_logs, auth_tokens RESTART IDENTITY CASCADE`);
  await ctx.redis.client.flushdb();
  ctx.network.clearCache();
  ctx.mail.outbox.length = 0;
}

export async function createUser(ctx: Ctx, o: {
  email?: string; verified?: boolean; status?: string; quota?: number; role?: string; password?: string;
} = {}): Promise<{ id: string; email: string }> {
  const email = o.email ?? `u${Math.random().toString(36).slice(2, 10)}@test.vn`;
  const verified = o.verified ?? true;
  const hash = await ctx.passwords.hash(o.password ?? PASSWORD);
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, role, status, email_verified, device_quota)
     VALUES ($1, $2, 'Học viên Test', $3::user_role, $4::user_status, $5, $6) RETURNING id`,
    [email, hash, o.role ?? 'student', o.status ?? (verified ? 'active' : 'pending_verification'), verified, o.quota ?? 3]);
  return { id: r.rows[0].id, email };
}

export async function createCourse(ctx: Ctx, slug: string, durationDays: number | null, price = 2_400_000): Promise<string> {
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO courses (slug, title, price_vnd, duration_days, is_published) VALUES ($1, $1, $2, $3, true) RETURNING id`,
    [slug, price, durationDays]);
  return r.rows[0].id;
}

/** Tạo mã trong DB đúng như module admin sẽ làm (HMAC với pepper hiện hành, không lưu plaintext). */
export async function createCode(ctx: Ctx, courseId: string, o: {
  kind?: 'activation' | 'extension'; grantDays?: number; boundEmail?: string; expiresAt?: Date;
  status?: string; keyIndex?: number; redeemedBy?: string;
} = {}): Promise<{ display: string; normalized: string; id: string }> {
  const { normalized, display, hint } = generateCode();
  const pepper = ctx.cfg.peppers[o.keyIndex ?? 0];
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO activation_codes (course_id, code_hmac, code_hint, kind, grant_days, bound_email, expires_at, status, hmac_key_id,
                                   redeemed_by, redeemed_at, revoked_at)
     VALUES ($1, $2, $3, $4::code_kind, $5, $6, $7, $8::code_status, $9, $10, $11, $12) RETURNING id`,
    [courseId, ctx.keyring.hmacWith(pepper, normalized), hint, o.kind ?? 'activation', o.grantDays ?? null, o.boundEmail ?? null,
      o.expiresAt ?? null, o.status ?? 'unused', pepper.id, o.redeemedBy ?? null, o.redeemedBy ? new Date() : null,
      o.status === 'revoked' ? new Date() : null]);
  return { display, normalized, id: r.rows[0].id };
}

export const ip = (addr: string) => ({ 'X-Forwarded-For': addr });

export async function login(ctx: Ctx, agent: ReturnType<typeof request.agent>, email: string, password = PASSWORD, addr = '198.51.100.1') {
  return agent.post('/v1/auth/login').set(ip(addr)).send({ email, password });
}

/** Giá trị thô của một cookie từ header Set-Cookie. */
export function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const line = raw.find((c) => c.startsWith(`${name}=`));
  return line ? decodeURIComponent(line.split(';')[0].slice(name.length + 1)) : undefined;
}
export const refreshCookieOf = (res: request.Response) => cookieValue(res, REFRESH_COOKIE);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
