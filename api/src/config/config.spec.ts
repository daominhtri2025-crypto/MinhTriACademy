import { loadConfig, parsePeppers } from './config';

const hex = (c: string) => c.repeat(64);
const base = {
  DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x', JWT_ACCESS_SECRET: 'x'.repeat(40), ACTIVATION_PEPPERS: `1:${hex('a')}`,
};

describe('config', () => {
  it('nạp giá trị mặc định hợp lý', () => {
    const c = loadConfig({ ...base });
    expect(c.ACCESS_TTL_SEC).toBe(900);
    expect(c.REFRESH_GRACE_SEC).toBe(10);
    expect(c.ACT_FAIL_USER_LIMIT).toBe(5);
    expect(c.COOKIE_SECURE).toBe(false);
    expect(c.HIBP_ENABLED).toBe(false);
  });

  it('thiếu biến bắt buộc hoặc secret quá ngắn → lỗi rõ ràng', () => {
    expect(() => loadConfig({})).toThrow(/Cấu hình không hợp lệ/);
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('production bắt buộc ALLOWED_ORIGINS và bật cookie Secure', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/ALLOWED_ORIGINS/);
    const c = loadConfig({ ...base, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://a.vn, https://b.vn' });
    expect(c.ALLOWED_ORIGINS).toEqual(['https://a.vn', 'https://b.vn']);
    expect(c.COOKIE_SECURE).toBe(true);
  });

  describe('parsePeppers', () => {
    it('khóa đầu tiên là khóa hiện hành; hỗ trợ nhiều khóa để xoay', () => {
      const p = parsePeppers(`2:${hex('b')},1:${hex('a')}`);
      expect(p.map((x) => x.id)).toEqual([2, 1]);
      expect(p[0].key).toHaveLength(32);
    });
    it('từ chối khóa ngắn, sai định dạng hoặc id trùng', () => {
      expect(() => parsePeppers('1:abcd')).toThrow();
      expect(() => parsePeppers('x:' + hex('a'))).toThrow();
      expect(() => parsePeppers(`1:${hex('a')},1:${hex('b')}`)).toThrow(/trùng/);
    });
  });
});
