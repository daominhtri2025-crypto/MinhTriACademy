import type { CookieOptions, Request, Response } from 'express';
import { AppConfig } from '../config/config';
import { isDeviceCookie, randomToken } from '../security/crypto.util';

export const REFRESH_COOKIE = 'mta_rt';
export const DEVICE_COOKIE = 'mta_did';

// Cả hai cookie giới hạn path /v1/auth: không bị gửi kèm mọi request API khác.
const base = (cfg: AppConfig): CookieOptions => ({
  httpOnly: true, secure: cfg.COOKIE_SECURE, sameSite: 'lax', path: '/v1/auth',
});

export function setRefreshCookie(res: Response, raw: string, cfg: AppConfig): void {
  res.cookie(REFRESH_COOKIE, raw, { ...base(cfg), maxAge: cfg.REFRESH_TTL_DAYS * 86_400_000 });
}

export function clearRefreshCookie(res: Response, cfg: AppConfig): void {
  res.clearCookie(REFRESH_COOKIE, base(cfg));
}

/** Cookie thiết bị: chuỗi ngẫu nhiên 256-bit (KHÔNG phải fingerprint). Chưa có/sai định dạng → cấp mới và đặt cookie 1 năm. */
export function ensureDeviceCookie(req: Request, res: Response, cfg: AppConfig): string {
  const existing = (req.cookies as Record<string, unknown> | undefined)?.[DEVICE_COOKIE];
  if (isDeviceCookie(existing)) return existing;
  const fresh = randomToken(32);
  res.cookie(DEVICE_COOKIE, fresh, { ...base(cfg), maxAge: 365 * 86_400_000 });
  return fresh;
}
