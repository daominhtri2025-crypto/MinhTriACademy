import { ALPHABET, CODE_LEN, checkChar, codeHint, formatCode, generateCode, hasValidChecksum, normalizeCode } from './code-format';

describe('code-format', () => {
  it('mã sinh ra có đúng định dạng MTA-XXXX-XXXX-XXXX và checksum hợp lệ', () => {
    for (let i = 0; i < 200; i++) {
      const { normalized, display, hint } = generateCode();
      expect(normalized).toHaveLength(CODE_LEN);
      expect(display).toMatch(/^MTA-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(hasValidChecksum(normalized)).toBe(true);
      expect(hint).toBe(`…${normalized.slice(-4)}`);
      expect(normalizeCode(display)).toBe(normalized);
    }
  });

  it('bảng chữ không chứa ký tự dễ nhầm I, L, O, U', () => {
    expect(ALPHABET).toHaveLength(32);
    for (const ch of 'ILOU') expect(ALPHABET).not.toContain(ch);
  });

  it('không có trùng lặp trong 20.000 mã sinh ngẫu nhiên', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(generateCode().normalized);
    expect(seen.size).toBe(20_000);
  });

  it('phát hiện MỌI lỗi sai một ký tự (vét cạn: 12 vị trí × 31 ký tự thay thế × 50 mã)', () => {
    for (let n = 0; n < 50; n++) {
      const { normalized } = generateCode();
      for (let pos = 0; pos < CODE_LEN; pos++) {
        for (const ch of ALPHABET) {
          if (ch === normalized[pos]) continue;
          const bad = normalized.slice(0, pos) + ch + normalized.slice(pos + 1);
          expect(hasValidChecksum(bad)).toBe(false);
        }
      }
    }
  });

  it('phát hiện phần lớn lỗi đảo hai ký tự liền kề (Luhn mod N không phát hiện 100%: ghi nhận tỷ lệ thực)', () => {
    let swaps = 0;
    let detected = 0;
    for (let n = 0; n < 500; n++) {
      const { normalized } = generateCode();
      for (let i = 0; i < CODE_LEN - 1; i++) {
        if (normalized[i] === normalized[i + 1]) continue;
        const arr = [...normalized];
        [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
        swaps++;
        if (!hasValidChecksum(arr.join(''))) detected++;
      }
    }
    expect(detected / swaps).toBeGreaterThan(0.95);
  });

  describe('normalizeCode', () => {
    const { normalized, display } = generateCode();

    it('chấp nhận chữ thường, khoảng trắng, gạch nối, có/không tiền tố', () => {
      expect(normalizeCode(display.toLowerCase())).toBe(normalized);
      expect(normalizeCode(display.replace(/-/g, ' '))).toBe(normalized);
      expect(normalizeCode(`  ${display}  `)).toBe(normalized);
      expect(normalizeCode(normalized)).toBe(normalized);
      expect(normalizeCode(`MTA${normalized}`)).toBe(normalized);
    });

    it('ánh xạ ký tự dễ nhầm: O→0, I→1, L→1', () => {
      expect(normalizeCode('MTA-OOOO-IIII-LLLL')).toBe('000011111111');
    });

    it('từ chối sai độ dài hoặc ký tự ngoài bảng chữ', () => {
      expect(normalizeCode('')).toBeNull();
      expect(normalizeCode('ABC')).toBeNull();
      expect(normalizeCode(`${normalized}0`)).toBeNull();
      expect(normalizeCode(`XXX${normalized}`)).toBeNull(); // 15 ký tự nhưng không phải tiền tố MTA
      expect(normalizeCode(`${normalized.slice(0, 11)}U`)).toBeNull(); // U không thuộc bảng chữ
      expect(normalizeCode(`${normalized.slice(0, 11)}#`)).toBeNull();
    });

    it('hasValidChecksum từ chối chuỗi sai độ dài hoặc sai bảng chữ', () => {
      expect(hasValidChecksum('')).toBe(false);
      expect(hasValidChecksum(normalized.slice(0, 11))).toBe(false);
      expect(hasValidChecksum(`${normalized.slice(0, 11)}u`)).toBe(false);
    });
  });

  it('checkChar/formatCode/codeHint nhất quán', () => {
    const payload = '0123456789A';
    const full = payload + checkChar(payload);
    expect(hasValidChecksum(full)).toBe(true);
    expect(formatCode(full)).toBe(`MTA-${full.slice(0, 4)}-${full.slice(4, 8)}-${full.slice(8)}`);
    expect(codeHint(full)).toBe(`…${full.slice(-4)}`);
  });
});
