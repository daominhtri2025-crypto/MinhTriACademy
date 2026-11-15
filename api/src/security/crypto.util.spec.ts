import { hmacSha256, isDeviceCookie, randomToken, safeEqualHex, sha256Hex } from './crypto.util';
import { deviceLabel } from '../auth/devices.service';
import { normalizeIp } from '../common/http';

describe('crypto.util', () => {
  it('randomToken: 32 byte → 43 ký tự base64url, không lặp', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isDeviceCookie(a)).toBe(true);
    expect(randomToken()).not.toBe(a);
  });

  it('isDeviceCookie chặn giá trị sai định dạng', () => {
    for (const v of [undefined, 42, '', 'short', 'x'.repeat(44), `${'a'.repeat(42)}!`]) expect(isDeviceCookie(v)).toBe(false);
  });

  it('sha256Hex khớp vector chuẩn', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hmacSha256 phụ thuộc cả khóa lẫn thông điệp', () => {
    const k1 = Buffer.alloc(32, 1);
    const k2 = Buffer.alloc(32, 2);
    expect(hmacSha256(k1, 'm').equals(hmacSha256(k1, 'm'))).toBe(true);
    expect(hmacSha256(k1, 'm').equals(hmacSha256(k2, 'm'))).toBe(false);
    expect(hmacSha256(k1, 'm').equals(hmacSha256(k1, 'n'))).toBe(false);
  });

  it('safeEqualHex', () => {
    expect(safeEqualHex('abcd', 'abcd')).toBe(true);
    expect(safeEqualHex('abcd', 'abce')).toBe(false);
    expect(safeEqualHex('abcd', 'abcdef')).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
  });

  it('normalizeIp bỏ tiền tố IPv4-mapped', () => {
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeIp(undefined)).toBe('0.0.0.0');
  });

  it('deviceLabel nhận diện trình duyệt/hệ điều hành thường gặp', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537')).toBe('Chrome / Windows');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604')).toBe('Safari / iOS');
    expect(deviceLabel('')).toBe('Trình duyệt / Không rõ');
  });
});
