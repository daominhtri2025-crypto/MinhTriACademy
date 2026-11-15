import { randomInt } from 'node:crypto';

/**
 * Mã kích hoạt: `MTA-XXXX-XXXX-XXXX` = 11 ký tự dữ liệu + 1 ký tự kiểm tra (Luhn mod 32) = 12 ký tự, ≈ 55 bit entropy.
 * (Sửa mâu thuẫn ở ARCHITECTURE §2.1 cũ: "12 ký tự + 1 checksum" không khớp định dạng 12 ký tự hiển thị.)
 * Bảng chữ Crockford Base32: bỏ I, L, O, U để tránh nhầm lẫn khi gõ.
 */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAYLOAD_LEN = 11;
export const CODE_LEN = PAYLOAD_LEN + 1;
export const PREFIX = 'MTA';
const N = ALPHABET.length; // 32

const cp = (ch: string): number => ALPHABET.indexOf(ch);

/** Tổng Luhn mod N duyệt từ phải sang trái, hệ số xen kẽ bắt đầu từ `startFactor`. */
function luhnSum(s: string, startFactor: 1 | 2): number {
  let factor: number = startFactor;
  let sum = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const addend = factor * cp(s[i]);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / N) + (addend % N);
  }
  return sum;
}

/** Ký tự kiểm tra cho 11 ký tự dữ liệu. */
export function checkChar(payload: string): string {
  return ALPHABET[(N - (luhnSum(payload, 2) % N)) % N];
}

/** `code12` đã chuẩn hóa (12 ký tự, đúng bảng chữ) có checksum hợp lệ hay không. */
export function hasValidChecksum(code12: string): boolean {
  return code12.length === CODE_LEN && [...code12].every((ch) => cp(ch) >= 0) && luhnSum(code12, 1) % N === 0;
}

/**
 * Chuẩn hóa đầu vào người dùng: in hoa, bỏ khoảng trắng/gạch nối, ánh xạ O→0, I/L→1, bỏ tiền tố MTA.
 * Trả null nếu sai độ dài hoặc có ký tự ngoài bảng chữ. KHÔNG kiểm checksum (xem hasValidChecksum).
 */
export function normalizeCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length === CODE_LEN + PREFIX.length && s.startsWith(PREFIX)) s = s.slice(PREFIX.length);
  if (s.length !== CODE_LEN || ![...s].every((ch) => cp(ch) >= 0)) return null;
  return s;
}

export const formatCode = (code12: string): string => `${PREFIX}-${code12.slice(0, 4)}-${code12.slice(4, 8)}-${code12.slice(8, 12)}`;
export const codeHint = (code12: string): string => `…${code12.slice(-4)}`;

/** Sinh mã bằng CSPRNG (randomInt không thiên lệch). Dùng cho module admin sinh lô mã. */
export function generateCode(): { normalized: string; display: string; hint: string } {
  let payload = '';
  for (let i = 0; i < PAYLOAD_LEN; i++) payload += ALPHABET[randomInt(N)];
  const normalized = payload + checkChar(payload);
  return { normalized, display: formatCode(normalized), hint: codeHint(normalized) };
}
