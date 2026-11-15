import { z } from 'zod';

export const CONFIG = Symbol('CONFIG');

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const int = (def: number) => z.coerce.number().int().positive().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET phải >= 32 ký tự'),
  ACCESS_TTL_SEC: int(900),
  REFRESH_TTL_DAYS: int(30),
  REFRESH_FAMILY_MAX_DAYS: int(90),
  REFRESH_GRACE_SEC: int(10),
  ACTIVATION_PEPPERS: z.string().min(1),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  ALLOWED_ORIGINS: z.string().default(''),
  WEB_BASE_URL: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: bool.optional(),
  // Rate limit — đếm theo LẦN THẤT BẠI (xem docs/DECISIONS.md, báo cáo §3.3)
  LOGIN_FAIL_EMAIL_LIMIT: int(10),
  LOGIN_FAIL_IP_LIMIT: int(50),
  ACT_FAIL_USER_LIMIT: int(5),
  ACT_FAIL_IP_LIMIT: int(100),
  REGISTER_IP_LIMIT: int(10),
  RL_TRUSTED_MULTIPLIER: int(10),
  DEVICE_OTP_TTL_SEC: int(600),
  MINOR_AGE_THRESHOLD: int(16),
  HIBP_ENABLED: bool.default('false'),
});

export interface Pepper { id: number; key: Buffer }

/** "1:<hex>,2:<hex>" → danh sách khóa; khóa đầu tiên là khóa hiện hành. */
export function parsePeppers(raw: string): Pepper[] {
  const peppers = raw.split(',').map((part) => {
    const [id, hex] = part.trim().split(':');
    if (!/^\d+$/.test(id ?? '') || !/^[0-9a-fA-F]{64,}$/.test(hex ?? '')) {
      throw new Error('ACTIVATION_PEPPERS sai định dạng: cần "id:hex(>=64 ký tự)" phân tách bằng dấu phẩy');
    }
    return { id: Number(id), key: Buffer.from(hex, 'hex') };
  });
  if (new Set(peppers.map((p) => p.id)).size !== peppers.length) throw new Error('ACTIVATION_PEPPERS: id trùng');
  return peppers;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Cấu hình không hợp lệ: ${msg}`);
  }
  const e = parsed.data;
  const allowedOrigins = e.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  if (e.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    throw new Error('Cấu hình không hợp lệ: ALLOWED_ORIGINS bắt buộc ở production');
  }
  return {
    ...e,
    ALLOWED_ORIGINS: allowedOrigins,
    COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    peppers: parsePeppers(e.ACTIVATION_PEPPERS),
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
