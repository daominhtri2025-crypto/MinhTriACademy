import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ALPHABET, generateCode } from '../src/activation/code-format';
import { Ctx, createCode, createCourse, createTestApp, createUser, ip, login, resetState } from './helpers';

async function tokenFor(ctx: Ctx, email: string): Promise<string> {
  const r = await login(ctx, request.agent(ctx.http), email);
  expect(r.status).toBe(200);
  return r.body.access_token;
}
const activate = (ctx: Ctx, token: string, code: string, addr = '198.51.100.1') =>
  request(ctx.http).post('/v1/activate').set('Authorization', `Bearer ${token}`).set(ip(addr)).send({ code });

const DAY = 86_400_000;
const inDays = (d: Date | string | null) => (new Date(d as string).getTime() - Date.now()) / DAY;

describe('POST /v1/activate', () => {
  let ctx: Ctx;
  let python: string;
  let java: string;
  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetState(ctx);
    python = await createCourse(ctx, 'python', 180);
    java = await createCourse(ctx, 'java', null, 2_900_000);
  });

  describe('kích hoạt thành công', () => {
    it('tạo enrollment theo thời hạn khóa, ghi sổ cái, đánh dấu mã đã dùng, audit không chứa mã', async () => {
      const u = await createUser(ctx);
      const code = await createCode(ctx, python);
      const res = await activate(ctx, await tokenFor(ctx, u.email), code.display);

      expect(res.status).toBe(200);
      expect(res.body.enrollment).toMatchObject({ course_id: python, status: 'active' });
      expect(inDays(res.body.enrollment.expires_at)).toBeGreaterThan(179.9);
      expect(inDays(res.body.enrollment.expires_at)).toBeLessThan(180.1);
      expect(res.body.grant.is_extension).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain(code.normalized);

      const c = await ctx.db.query('SELECT status, redeemed_by FROM activation_codes WHERE id = $1', [code.id]);
      expect(c.rows[0]).toEqual({ status: 'used', redeemed_by: u.id });
      const g = await ctx.db.query('SELECT source, price_paid_vnd, is_extension FROM enrollment_grants');
      expect(g.rows).toEqual([{ source: 'code', price_paid_vnd: 2_400_000, is_extension: false }]);

      const audit = await ctx.db.query('SELECT action, meta::text AS meta FROM audit_logs');
      expect(audit.rows.map((r) => r.action)).toContain('code.redeem');
      expect(audit.rows.map((r) => r.meta).join('')).not.toContain(code.normalized); // mã không bao giờ vào log
    });

    it('chấp nhận chữ thường, bỏ gạch nối/tiền tố, có khoảng trắng', async () => {
      const u = await createUser(ctx);
      const token = await tokenFor(ctx, u.email);
      const a = await createCode(ctx, python);
      expect((await activate(ctx, token, a.display.toLowerCase().replace(/-/g, ' '))).status).toBe(200);
    });

    it('khóa vĩnh viễn (duration_days NULL) → expires_at NULL', async () => {
      const u = await createUser(ctx);
      const res = await activate(ctx, await tokenFor(ctx, u.email), (await createCode(ctx, java)).display);
      expect(res.status).toBe(200);
      expect(res.body.enrollment.expires_at).toBeNull();
    });

    it('mã gắn khóa xoay pepper (hmac_key_id = 1, khóa cũ) vẫn dùng được', async () => {
      const u = await createUser(ctx);
      const old = await createCode(ctx, python, { keyIndex: 1 });
      expect((await activate(ctx, await tokenFor(ctx, u.email), old.display)).status).toBe(200);
    });
  });

  describe('xác thực & kiểm tra đầu vào', () => {
    it('cần đăng nhập; email chưa xác minh bị từ chối và không tính vào bộ đếm', async () => {
      expect((await request(ctx.http).post('/v1/activate').send({ code: 'MTA-AAAA-AAAA-AAAA' })).status).toBe(401);
      const u = await createUser(ctx, { verified: false });
      const token = await tokenFor(ctx, u.email);
      const code = await createCode(ctx, python);
      for (let i = 0; i < 8; i++) {
        const r = await activate(ctx, token, code.display);
        expect(r.status).toBe(403);
        expect(r.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      }
      expect((await ctx.db.query('SELECT status FROM activation_codes WHERE id = $1', [code.id])).rows[0].status).toBe('unused');
    });

    it('gõ sai ký tự → 422, không chạm DB, không tính vào bộ đếm thất bại (10 lần gõ sai vẫn dùng được mã đúng)', async () => {
      const u = await createUser(ctx);
      const token = await tokenFor(ctx, u.email);
      const code = await createCode(ctx, python);
      const pos = 0;
      const wrongChar = ALPHABET[(ALPHABET.indexOf(code.normalized[pos]) + 1) % 32];
      const typo = code.normalized.slice(0, pos) + wrongChar + code.normalized.slice(pos + 1);
      for (let i = 0; i < 10; i++) {
        const r = await activate(ctx, token, typo);
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe('CODE_FORMAT_INVALID');
      }
      expect((await activate(ctx, token, code.display)).status).toBe(200);
    });

    it('đầu vào rác bị DTO chặn', async () => {
      const token = await tokenFor(ctx, (await createUser(ctx)).email);
      for (const body of [{}, { code: 5 }, { code: 'x' }, { code: 'A'.repeat(100) }, { code: 'MTA-AAAA-AAAA-AAAA', extra: 1 }]) {
        const r = await request(ctx.http).post('/v1/activate').set('Authorization', `Bearer ${token}`).send(body);
        expect(r.status).toBe(422);
      }
    });
  });

  describe('phản hồi thất bại thống nhất (chống dò trạng thái mã)', () => {
    it('không tồn tại / gắn email khác / đã dùng bởi người khác / bị thu hồi / hết hạn → CÙNG status & body; lý do thật nằm trong audit', async () => {
      const other = await createUser(ctx);
      const results: Array<{ status: number; body: unknown }> = [];
      const attempt = async (code: string) => {
        const u = await createUser(ctx); // mỗi kịch bản một người dùng để không đụng giới hạn
        const r = await activate(ctx, await tokenFor(ctx, u.email), code);
        results.push({ status: r.status, body: r.body });
      };
      await attempt(generateCode().display);                                                              // không tồn tại
      await attempt((await createCode(ctx, python, { boundEmail: 'someone.else@test.vn' })).display);     // gắn email khác
      await attempt((await createCode(ctx, python, { status: 'used', redeemedBy: other.id })).display);   // đã dùng bởi người khác
      await attempt((await createCode(ctx, python, { status: 'revoked' })).display);                      // đã thu hồi
      const expired = await createCode(ctx, python, { expiresAt: new Date(Date.now() - DAY) });
      await attempt(expired.display);                                                                     // hết hạn

      expect(results).toHaveLength(5);
      for (const r of results) {
        expect(r.status).toBe(404);
        expect(r.body).toEqual(results[0].body);
      }
      expect((results[0].body as { error: { code: string } }).error.code).toBe('CODE_INVALID');

      const reasons = (await ctx.db.query(`SELECT meta->>'reason' AS reason FROM audit_logs WHERE action LIKE 'code.redeem%'`)).rows.map((r) => r.reason);
      expect(reasons.sort()).toEqual(['email_mismatch', 'expired', 'not_found', 'revoked', 'unusable']);
      expect((await ctx.db.query('SELECT status FROM activation_codes WHERE id = $1', [expired.id])).rows[0].status).toBe('expired');
    });

    it('chính chủ dùng lại mã của mình → 409 riêng, không tính vào bộ đếm', async () => {
      const u = await createUser(ctx);
      const token = await tokenFor(ctx, u.email);
      const code = await createCode(ctx, python);
      expect((await activate(ctx, token, code.display)).status).toBe(200);
      for (let i = 0; i < 10; i++) {
        const r = await activate(ctx, token, code.display);
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('ALREADY_REDEEMED_BY_YOU');
      }
    });
  });

  describe('gắn 1-1 với email', () => {
    it('mã gắn email: chỉ chủ email (không phân biệt hoa thường) kích hoạt được', async () => {
      const alice = await createUser(ctx, { email: 'alice@test.vn' });
      const bob = await createUser(ctx, { email: 'bob@test.vn' });
      const code = await createCode(ctx, python, { boundEmail: 'Alice@Test.vn' });
      expect((await activate(ctx, await tokenFor(ctx, bob.email), code.display)).status).toBe(404);
      expect((await ctx.db.query('SELECT status FROM activation_codes WHERE id = $1', [code.id])).rows[0].status).toBe('unused');
      expect((await activate(ctx, await tokenFor(ctx, alice.email), code.display)).status).toBe(200);
    });

    it('tài khoản trẻ em do phụ huynh quản lý: khớp email phụ huynh đã xác minh', async () => {
      const guardian = await createUser(ctx, { email: 'parent@test.vn', role: 'guardian' });
      const child = await ctx.db.query<{ id: string }>(
        `INSERT INTO users (username, full_name, is_managed, status) VALUES ('be.an', 'Bé An', true, 'active') RETURNING id`);
      await ctx.db.query('INSERT INTO guardian_links (guardian_id, child_id) VALUES ($1, $2)', [guardian.id, child.rows[0].id]);
      const token = ctx.tokens.signAccess({ userId: child.rows[0].id, role: 'student', familyId: randomUUID(), deviceId: randomUUID() }).token;

      const wrong = await createCode(ctx, python, { boundEmail: 'stranger@test.vn' });
      expect((await activate(ctx, token, wrong.display)).status).toBe(404);
      const right = await createCode(ctx, python, { boundEmail: 'parent@test.vn' });
      const res = await activate(ctx, token, right.display);
      expect(res.status).toBe(200);
      expect((await ctx.db.query('SELECT user_id FROM enrollments')).rows[0].user_id).toBe(child.rows[0].id);
    });
  });

  describe('gia hạn (ADR-002): giữ nguyên tiến độ', () => {
    it('cộng dồn từ ngày hết hạn hiện tại; progress và submissions không bị đụng tới', async () => {
      const u = await createUser(ctx);
      const token = await tokenFor(ctx, u.email);
      expect((await activate(ctx, token, (await createCode(ctx, python)).display)).status).toBe(200);

      const ch = await ctx.db.query<{ id: string }>(`INSERT INTO chapters (course_id, title, sort_order) VALUES ($1, 'C1', 1) RETURNING id`, [python]);
      const ls = await ctx.db.query<{ id: string }>(`INSERT INTO lessons (chapter_id, title, type, sort_order) VALUES ($1, 'L1', 'coding', 1) RETURNING id`, [ch.rows[0].id]);
      await ctx.db.query('INSERT INTO progress (user_id, lesson_id, completed_at) VALUES ($1, $2, now())', [u.id, ls.rows[0].id]);
      await ctx.db.query(
        `INSERT INTO submissions (user_id, lesson_id, kind, payload, code_sha256) VALUES ($1, $2, 'coding', '{"code":"print(1)"}', '\\x01')`, [u.id, ls.rows[0].id]);
      const before = (await ctx.db.query('SELECT id, expires_at FROM enrollments')).rows[0];

      const ext = await createCode(ctx, python, { kind: 'extension', grantDays: 90 });
      const res = await activate(ctx, token, ext.display);
      expect(res.status).toBe(200);
      expect(res.body.grant.is_extension).toBe(true);
      expect(new Date(res.body.enrollment.expires_at).getTime() - new Date(before.expires_at).getTime()).toBeCloseTo(90 * DAY, -4);

      const after = await ctx.db.query('SELECT id FROM enrollments');
      expect(after.rowCount).toBe(1);
      expect(after.rows[0].id).toBe(before.id);
      expect((await ctx.db.query('SELECT 1 FROM progress WHERE user_id = $1', [u.id])).rowCount).toBe(1);
      expect((await ctx.db.query('SELECT 1 FROM submissions WHERE user_id = $1', [u.id])).rowCount).toBe(1);
    });

    it('hết hạn rồi gia hạn: tính từ hiện tại và kích hoạt lại', async () => {
      const u = await createUser(ctx);
      const token = await tokenFor(ctx, u.email);
      await activate(ctx, token, (await createCode(ctx, python)).display);
      await ctx.db.query(`UPDATE enrollments SET expires_at = now() - interval '30 days', status = 'expired'`);
      const res = await activate(ctx, token, (await createCode(ctx, python, { kind: 'extension', grantDays: 180 })).display);
      expect(res.status).toBe(200);
      expect(res.body.enrollment.status).toBe('active');
      expect(inDays(res.body.enrollment.expires_at)).toBeGreaterThan(179.9);
      expect(inDays(res.body.enrollment.expires_at)).toBeLessThan(180.1);
    });

    it('mã gia hạn khi chưa có khóa → 409 và KHÔNG đốt mã; khóa vĩnh viễn → 409 và KHÔNG đốt mã; không tính bộ đếm', async () => {
      const u = await createUser(ctx);
      const token = await tokenFor(ctx, u.email);
      const ext = await createCode(ctx, python, { kind: 'extension', grantDays: 90 });
      for (let i = 0; i < 8; i++) expect((await activate(ctx, token, ext.display)).body.error.code).toBe('NO_ENROLLMENT_TO_EXTEND');
      expect((await ctx.db.query('SELECT status FROM activation_codes WHERE id = $1', [ext.id])).rows[0].status).toBe('unused');

      await activate(ctx, token, (await createCode(ctx, java)).display); // vĩnh viễn
      const extJava = await createCode(ctx, java, { kind: 'extension', grantDays: 30 });
      const r = await activate(ctx, token, extJava.display);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('ALREADY_LIFETIME');
      expect((await ctx.db.query('SELECT status FROM activation_codes WHERE id = $1', [extJava.id])).rows[0].status).toBe('unused');
    });
  });

  describe('đua giao dịch (transaction + khóa hàng + UNIQUE ở DB)', () => {
    it('hai người cùng dùng MỘT mã: đúng một người thắng; lặp 5 lần', async () => {
      const a = await createUser(ctx);
      const b = await createUser(ctx);
      const [ta, tb] = [await tokenFor(ctx, a.email), await tokenFor(ctx, b.email)];
      for (let i = 0; i < 5; i++) {
        const code = await createCode(ctx, python);
        const [ra, rb] = await Promise.all([activate(ctx, ta, code.display), activate(ctx, tb, code.display)]);
        expect([ra.status, rb.status].sort()).toEqual([200, 404]);
        await ctx.db.query('DELETE FROM enrollments');                       // dọn cho vòng sau
        await ctx.redis.client.flushdb();                                    // dọn bộ đếm thất bại
      }
      expect((await ctx.db.query(`SELECT 1 FROM activation_codes WHERE status = 'used'`)).rowCount).toBe(5);
    });

    it('một người bấm 2 lần đồng thời cùng một mã: một 200, một 409 (không nhân đôi quyền)', async () => {
      const u = await createUser(ctx);
      const token = await tokenFor(ctx, u.email);
      const code = await createCode(ctx, python);
      const [r1, r2] = await Promise.all([activate(ctx, token, code.display), activate(ctx, token, code.display)]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect((await ctx.db.query('SELECT 1 FROM enrollment_grants')).rowCount).toBe(1);
    });

    it('một người dùng 2 mã khác nhau của cùng khóa đồng thời: chỉ 1 enrollment, 2 lần cấp (lần sau là gia hạn)', async () => {
      const u = await createUser(ctx);
      const token = await tokenFor(ctx, u.email);
      const [c1, c2] = [await createCode(ctx, python), await createCode(ctx, python)];
      const [r1, r2] = await Promise.all([activate(ctx, token, c1.display), activate(ctx, token, c2.display)]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      expect((await ctx.db.query('SELECT 1 FROM enrollments')).rowCount).toBe(1);
      const grants = await ctx.db.query('SELECT is_extension FROM enrollment_grants ORDER BY is_extension');
      expect(grants.rows.map((g) => g.is_extension)).toEqual([false, true]);
      const e = (await ctx.db.query('SELECT expires_at FROM enrollments')).rows[0];
      expect(inDays(e.expires_at)).toBeGreaterThan(359.9);
      expect(inDays(e.expires_at)).toBeLessThan(360.1);
    });
  });
});

describe('POST /v1/activate — rate limit (chỉ đếm thất bại; nới cho IP trung tâm)', () => {
  let ctx: Ctx;
  let python: string;
  beforeAll(async () => { ctx = await createTestApp({ ACT_FAIL_USER_LIMIT: '5', ACT_FAIL_IP_LIMIT: '3', RL_TRUSTED_MULTIPLIER: '10' }); });
  afterAll(() => ctx.app.close());
  beforeEach(async () => { await resetState(ctx); python = await createCourse(ctx, 'python', 180); });

  it('theo người dùng: 5 lần thất bại → lần 6 bị 429 + Retry-After, kể cả khi dùng mã ĐÚNG; mã không bị tiêu hao', async () => {
    const u = await createUser(ctx);
    const token = await tokenFor(ctx, u.email);
    // dùng nhiều IP khác nhau để không đụng giới hạn IP (đặt = 3)
    for (let i = 0; i < 5; i++) expect((await activate(ctx, token, generateCode().display, `198.51.100.${10 + i}`)).status).toBe(404);
    const valid = await createCode(ctx, python);
    const blocked = await activate(ctx, token, valid.display, '198.51.100.99');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await ctx.db.query('SELECT status FROM activation_codes WHERE id = $1', [valid.id])).rows[0].status).toBe('unused');
  });

  it('theo IP: IP thường bị chặn sau 3 thất bại (kể cả người dùng khác, chưa thất bại lần nào); IP trung tâm được nới ×10', async () => {
    const users = [];
    for (let i = 0; i < 8; i++) users.push(await tokenFor(ctx, (await createUser(ctx)).email));
    for (let i = 0; i < 3; i++) expect((await activate(ctx, users[i], generateCode().display, '198.51.100.50')).status).toBe(404);
    expect((await activate(ctx, users[3], generateCode().display, '198.51.100.50')).status).toBe(429);

    await ctx.db.query(`INSERT INTO trusted_networks (institution_name, cidr) VALUES ('MTA Đà Nẵng', '203.0.113.0/24')`);
    ctx.network.clearCache();
    for (let i = 0; i < 8; i++) expect((await activate(ctx, users[i], generateCode().display, '203.0.113.5')).status).toBe(404);
  });

  it('thành công KHÔNG tính vào bộ đếm: một người kích hoạt/gia hạn 7 lần liên tiếp (> ngưỡng 5 theo người dùng và 3 theo IP) không bị chặn', async () => {
    const u = await createUser(ctx);
    const token = await tokenFor(ctx, u.email);
    for (let i = 0; i < 7; i++) {
      const r = await activate(ctx, token, (await createCode(ctx, python)).display, '198.51.100.60');
      expect(r.status).toBe(200);
    }
  });

  it('kích hoạt thành công không làm tăng bộ đếm (cả lớp kích hoạt liên tiếp từ cùng IP trung tâm)', async () => {
    await ctx.db.query(`INSERT INTO trusted_networks (institution_name, cidr) VALUES ('TT', '203.0.113.0/24')`);
    for (let i = 0; i < 12; i++) {
      const u = await createUser(ctx);
      const r = await activate(ctx, await tokenFor(ctx, u.email), (await createCode(ctx, python)).display, '203.0.113.5');
      expect(r.status).toBe(200);
    }
  });
});
