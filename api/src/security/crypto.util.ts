import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (data: string | Buffer): Buffer => createHash('sha256').update(data).digest();
export const sha256Hex = (data: string | Buffer): string => sha256(data).toString('hex');

/** Token ngẫu nhiên (CSPRNG), mã hóa base64url. 32 byte → 43 ký tự. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const hmacSha256 = (key: Buffer, message: string): Buffer => createHmac('sha256', key).update(message).digest();

/** So sánh chuỗi hex cùng độ dài theo thời gian không đổi. */
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Định dạng cookie thiết bị hợp lệ: 32 byte base64url (43 ký tự). */
export const isDeviceCookie = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
