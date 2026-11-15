import request from 'supertest';
import { sha256Hex, randomToken } from '../src/security/crypto.util';
import { sha256 } from '../src/security/crypto.util';
import { Ctx, PASSWORD, cookieValue, createTestApp, createUser, ip, login, refreshCookieOf, resetState, sleep } from './helpers';

const post = (ctx: Ctx, path: string) => request(ctx.http).post(path);
const refreshWith = (ctx: Ctx, rt: string) => post(ctx, '/v1/auth/refresh').set('Cookie', `mta_rt=${rt}`);
const me = (ctx: Ctx, token: string) => request(ctx.http).get('/v1/auth/me').set('Authorization', `Bearer ${token}`);

async function loginRaw(ctx: Ctx, email: string, addr = '198.51.100.1') {
  const res = await post(ctx, '/v1/auth/login').set(ip(addr)).send({ email, password: PASSWORD });
  return { res, rt: refreshCookieOf(res)!, access: res.body.access_token as string };
}

describe('Auth — đăng ký, xác minh, đăng nhập', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(() => ctx.app.close());
  beforeEach(() => resetState(ctx));

  it('đăng ký → thư xác minh → xác minh (token một lần, DB chỉ lưu băm) → đăng nhập', async () => {
    const res = await post(ctx, '/v1/auth/register').send({ email: 'Mai@Test.vn', password: PASSWORD, full_name: 'Mai' });
    expect(res.status).toBe(202);
    const mail = ctx.mail.outbox.at(-1)!;
    expect(mail.to).toBe('mai@test.vn');
    const token = /token=([\w-]+)/.exec(mail.text)![1];

    const stored = await ctx.db.query<{ token_hash: Buffer }>('SELECT token_hash FROM auth_tokens');
    expect(stored.rows[0].token_hash.equals(sha256(token))).toBe(true); // lưu SHA-256, không lưu token thô

    expect((await post(ctx, '/v1/auth/verify-email').send({ token: 'x'.repeat(30) })).status).toBe(400);
    expect((await post(ctx, '/v1/auth/verify-email').send({ token })).status).toBe(200);
    expect((await post(ctx, '/v1/auth/verify-email').send({ token })).status).toBe(400); // dùng lại bị từ chối

    const u = await ctx.db.query('SELECT email_verified, status FROM users WHERE email = $1', ['mai@test.vn']);
    expect(u.rows[0]).toEqual({ email_verified: true, status: 'active' });
    expect((await post(ctx, '/v1/auth/login').send({ email: 'mai@test.vn', password: PASSWORD })).status).toBe(200);
  });

  it('đăng ký trùng email: phản hồi y hệt (không lộ email đã tồn tại), không tạo bản ghi thứ hai', async () => {
    const body = { email: 'dup@test.vn', password: PASSWORD, full_name: 'A' };
    const first = await post(ctx, '/v1/auth/register').send(body);
    const second = await post(ctx, '/v1/auth/register').send(body);
    expect([first.status, second.status]).toEqual([202, 202]);
    expect(second.body).toEqual(first.body);
    expect((await ctx.db.query('SELECT 1 FROM users WHERE email = $1', ['dup@test.vn'])).rowCount).toBe(1);
    expect(ctx.mail.outbox.at(-1)!.subject).toMatch(/đã có tài khoản/);
  });

  it('chính sách mật khẩu và trẻ em', async () => {
    const weak = await post(ctx, '/v1/auth/register').send({ email: 'a@test.vn', password: 'short', full_name: 'A' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');

    const same = await post(ctx, '/v1/auth/register').send({ email: 'longenough1@test.vn', password: 'longenough1@test.vn', full_name: 'A' });
    expect(same.body.error.code).toBe('PASSWORD_POLICY');

    const year = new Date().getUTCFullYear() - 10;
    const minor = await post(ctx, '/v1/auth/register').send({ email: 'kid@test.vn', password: PASSWORD, full_name: 'Bé', birth_year: year });
    expect(minor.status).toBe(422);
    expect(minor.body.error.code).toBe('GUARDIAN_REQUIRED');
    const ok = await post(ctx, '/v1/auth/register')
      .send({ email: 'kid@test.vn', password: PASSWORD, full_name: 'Bé', birth_year: year, guardian_email: 'parent@test.vn' });
    expect(ok.status).toBe(202);
  });

  it('trường lạ bị từ chối (whitelist), role không thể tự gán qua đăng ký', async () => {
    const res = await post(ctx, '/v1/auth/register').send({ email: 'evil@test.vn', password: PASSWORD, full_name: 'E', role: 'admin' });
    expect(res.status).toBe(422);
    expect((await ctx.db.query('SELECT 1 FROM users WHERE email = $1', ['evil@test.vn'])).rowCount).toBe(0);
  });

  it('đăng nhập sai: cùng một phản hồi cho "sai mật khẩu" và "email không tồn tại"', async () => {
    const u = await createUser(ctx);
    const wrong = await post(ctx, '/v1/auth/login').send({ email: u.email, password: 'wrong-password-123' });
    const unknown = await post(ctx, '/v1/auth/login').send({ email: 'nobody@test.vn', password: 'wrong-password-123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('đăng nhập đúng: cookie httpOnly path /v1/auth, DB chỉ lưu băm refresh token, /me hoạt động', async () => {
    const u = await createUser(ctx);
    const res = await post(ctx, '/v1/auth/login').set(ip('198.51.100.1')).send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('refresh_token');
    const cookies = ([] as string[]).concat(res.headers['set-cookie']);
    for (const name of ['mta_rt', 'mta_did']) {
      const c = cookies.find((x) => x.startsWith(`${name}=`))!;
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/Path=\/v1\/auth/);
      expect(c).toMatch(/SameSite=Lax/i);
    }
    const rt = refreshCookieOf(res)!;
    const row = await ctx.db.query<{ refresh_hash: string }>('SELECT refresh_hash FROM user_sessions');
    expect(row.rows[0].refresh_hash).toBe(sha256Hex(rt));
    expect(row.rows[0].refresh_hash).not.toBe(rt);

    expect((await me(ctx, res.body.access_token)).body.email).toBe(u.email);
    expect((await request(ctx.http).get('/v1/auth/me')).status).toBe(401);
    expect((await me(ctx, 'not.a.jwt')).status).toBe(401);
  });

  it('tài khoản bị khóa: chỉ lộ trạng thái khi mật khẩu đúng; chưa xác minh email vẫn đăng nhập được', async () => {
    const locked = await createUser(ctx, { status: 'locked' });
    expect((await post(ctx, '/v1/auth/login').send({ email: locked.email, password: 'wrong-password-123' })).status).toBe(401);
    const res = await post(ctx, '/v1/auth/login').send({ email: locked.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');

    const unverified = await createUser(ctx, { verified: false });
    const ok = await post(ctx, '/v1/auth/login').send({ email: unverified.email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email_verified).toBe(false);
  });

  it('access token không dùng được làm challenge, và ngược lại', async () => {
    const u = await createUser(ctx);
    const { access } = await loginRaw(ctx, u.email);
    expect((await post(ctx, '/v1/auth/devices/otp').send({ challenge_token: access })).status).toBe(401);
    const ch = ctx.tokens.signChallenge(u.id);
    expect((await me(ctx, ch)).status).toBe(401);
  });
});

describe('Auth — refresh token: xoay vòng, ân hạn, phát hiện dùng lại', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await createTestApp({ REFRESH_GRACE_SEC: '1' }); });
  afterAll(() => ctx.app.close());
  beforeEach(() => resetState(ctx));

  it('mỗi lần refresh phát token mới trong cùng họ; token cũ được đánh dấu đã xoay', async () => {
    const u = await createUser(ctx);
    const { rt: rt1 } = await loginRaw(ctx, u.email);
    const r2 = await refreshWith(ctx, rt1);
    expect(r2.status).toBe(200);
    const rt2 = refreshCookieOf(r2)!;
    expect(rt2).toBeTruthy();
    expect(rt2).not.toBe(rt1);
    expect((await me(ctx, r2.body.access_token)).status).toBe(200);

    const rows = await ctx.db.query('SELECT id, family_id, rotated_at, replaced_by FROM user_sessions ORDER BY created_at');
    expect(rows.rowCount).toBe(2);
    expect(rows.rows[0].family_id).toBe(rows.rows[1].family_id);
    expect(rows.rows[0].replaced_by).toBe(rows.rows[1].id);
    expect(rows.rows[0].rotated_at).not.toBeNull();
  });

  it('dùng lại token cũ NGOÀI cửa sổ ân hạn → thu hồi cả họ (kể cả token mới và access token đang sống)', async () => {
    const u = await createUser(ctx);
    const { rt: rt1 } = await loginRaw(ctx, u.email);
    const r2 = await refreshWith(ctx, rt1);
    const rt2 = refreshCookieOf(r2)!;
    await sleep(1300);

    const reuse = await refreshWith(ctx, rt1);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_REUSED');

    const reasons = await ctx.db.query<{ revoked_reason: string }>('SELECT revoked_reason FROM user_sessions');
    expect(reasons.rows.every((r) => r.revoked_reason === 'reuse_detected')).toBe(true);
    expect((await refreshWith(ctx, rt2)).status).toBe(401);                 // token mới của họ cũng chết
    expect((await me(ctx, r2.body.access_token)).body.error.code).toBe('SESSION_REVOKED'); // access token còn hạn cũng bị chặn
    const audit = await ctx.db.query(`SELECT 1 FROM audit_logs WHERE action = 'auth.refresh_reuse_detected'`);
    expect(audit.rowCount).toBe(1);
  });

  it('hai tab refresh cùng token trong cửa sổ ân hạn: cả hai thành công, chỉ MỘT phát cookie mới, họ không bị thu hồi', async () => {
    const u = await createUser(ctx);
    const { rt: rt1 } = await loginRaw(ctx, u.email);
    const [a, b] = await Promise.all([refreshWith(ctx, rt1), refreshWith(ctx, rt1)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const issued = [a, b].map((r) => refreshCookieOf(r)).filter(Boolean);
    expect(issued).toHaveLength(1);
    expect((await me(ctx, a.body.access_token)).status).toBe(200);
    expect((await me(ctx, b.body.access_token)).status).toBe(200);
    expect((await refreshWith(ctx, issued[0]!)).status).toBe(200);          // chuỗi token vẫn liền mạch
    expect((await ctx.db.query('SELECT 1 FROM user_sessions WHERE revoked_at IS NOT NULL')).rowCount).toBe(0);
  });

  it('token hết hạn tuyệt đối của họ, không tồn tại, hoặc thiếu cookie → 401', async () => {
    const u = await createUser(ctx);
    const { rt } = await loginRaw(ctx, u.email);
    await ctx.db.query(`UPDATE user_sessions SET family_expires_at = now() - interval '1 second'`);
    expect((await refreshWith(ctx, rt)).body.error.code).toBe('INVALID_REFRESH');
    expect((await refreshWith(ctx, randomToken(32))).status).toBe(401);
    expect((await post(ctx, '/v1/auth/refresh')).body.error.code).toBe('NO_REFRESH_TOKEN');
  });

  it('đăng xuất thu hồi cả họ; tài khoản bị khóa giữa chừng không refresh được nữa', async () => {
    const u = await createUser(ctx);
    const { rt, access } = await loginRaw(ctx, u.email);
    const out = await post(ctx, '/v1/auth/logout').set('Cookie', `mta_rt=${rt}`);
    expect(out.status).toBe(204);
    expect((await refreshWith(ctx, rt)).status).toBe(401);
    expect((await me(ctx, access)).body.error.code).toBe('SESSION_REVOKED');

    const u2 = await createUser(ctx);
    const l2 = await loginRaw(ctx, u2.email);
    await ctx.db.query(`UPDATE users SET status = 'locked' WHERE id = $1`, [u2.id]);
    expect((await refreshWith(ctx, l2.rt)).status).toBe(401);
    expect((await ctx.db.query(`SELECT 1 FROM user_sessions WHERE user_id = $1 AND revoked_reason = 'admin'`, [u2.id])).rowCount).toBe(1);
  });
});

describe('Auth — giới hạn thiết bị, OTP, kiosk', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(() => ctx.app.close());
  beforeEach(() => resetState(ctx));

  async function fillThreeDevices(email: string) {
    const agents = [request.agent(ctx.http), request.agent(ctx.http), request.agent(ctx.http)];
    const tokens: string[] = [];
    for (const a of agents) {
      const r = await login(ctx, a, email);
      expect(r.status).toBe(200);
      tokens.push(r.body.access_token);
    }
    return { agents, tokens };
  }

  it('tối đa 3 thiết bị: thiết bị thứ 4 bị chặn, không tạo phiên; đăng nhập lại trên cùng thiết bị không tốn slot', async () => {
    const u = await createUser(ctx);
    const { agents } = await fillThreeDevices(u.email);

    const a4 = request.agent(ctx.http);
    const blocked = await login(ctx, a4, u.email);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('DEVICE_LIMIT_REACHED');
    expect(blocked.body.error.details.devices).toHaveLength(3);
    expect(JSON.stringify(blocked.body)).not.toContain('198.51.100'); // không lộ IP của thiết bị khác
    expect((await ctx.db.query('SELECT 1 FROM user_sessions')).rowCount).toBe(3);

    expect((await login(ctx, agents[0], u.email)).status).toBe(200);
    expect((await ctx.db.query('SELECT 1 FROM user_devices WHERE revoked_at IS NULL')).rowCount).toBe(3);
  });

  it('gỡ thiết bị bằng OTP email: sai OTP bị từ chối; gỡ xong thiết bị cũ mất phiên NGAY, thiết bị mới đăng nhập được', async () => {
    const u = await createUser(ctx);
    const { agents, tokens } = await fillThreeDevices(u.email);
    const a4 = request.agent(ctx.http);
    const blocked = await login(ctx, a4, u.email);
    const challenge = blocked.body.error.details.challenge_token as string;

    expect((await post(ctx, '/v1/auth/devices/otp').send({ challenge_token: challenge })).status).toBe(202);
    const mail = ctx.mail.outbox.at(-1)!;
    expect(mail.to).toBe(u.email);
    const otp = /\b(\d{6})\b/.exec(mail.text)![1];
    const wrong = otp === '000000' ? '111111' : '000000';

    const target = (await request(ctx.http).get('/v1/auth/devices').set('Authorization', `Bearer ${tokens[1]}`)).body.devices
      .find((d: { current: boolean }) => d.current).id as string;

    const bad = await post(ctx, '/v1/auth/devices/revoke').send({ challenge_token: challenge, otp: wrong, device_ids: [target] });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('OTP_INVALID');

    const good = await post(ctx, '/v1/auth/devices/revoke').send({ challenge_token: challenge, otp, device_ids: [target] });
    expect(good.status).toBe(200);
    expect(good.body.revoked).toBe(1);
    expect((await post(ctx, '/v1/auth/devices/revoke').send({ challenge_token: challenge, otp, device_ids: [target] })).status).toBe(401); // OTP dùng một lần

    expect((await me(ctx, tokens[1])).body.error.code).toBe('SESSION_REVOKED');
    expect((await agents[1].post('/v1/auth/refresh')).status).toBe(401);
    expect((await me(ctx, tokens[0])).status).toBe(200); // các thiết bị còn lại không ảnh hưởng
    expect((await login(ctx, a4, u.email)).status).toBe(200);
  });

  it('OTP: tối đa 5 lần thử rồi hủy; tối đa 3 yêu cầu gửi OTP / 15 phút', async () => {
    const u = await createUser(ctx);
    await fillThreeDevices(u.email);
    const blocked = await login(ctx, request.agent(ctx.http), u.email);
    const challenge = blocked.body.error.details.challenge_token as string;
    const devId = blocked.body.error.details.devices[0].id as string;

    await post(ctx, '/v1/auth/devices/otp').send({ challenge_token: challenge });
    const otp = /\b(\d{6})\b/.exec(ctx.mail.outbox.at(-1)!.text)![1];
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await post(ctx, '/v1/auth/devices/revoke').send({ challenge_token: challenge, otp: wrong, device_ids: [devId] })).status).toBe(401);
    }
    const sixth = await post(ctx, '/v1/auth/devices/revoke').send({ challenge_token: challenge, otp, device_ids: [devId] });
    expect(sixth.status).toBe(429); // đã bị hủy dù lần này nhập ĐÚNG

    await post(ctx, '/v1/auth/devices/otp').send({ challenge_token: challenge });
    await post(ctx, '/v1/auth/devices/otp').send({ challenge_token: challenge });
    expect((await post(ctx, '/v1/auth/devices/otp').send({ challenge_token: challenge })).status).toBe(429);
  });

  it('người dùng đã đăng nhập tự gỡ thiết bị; không thể gỡ thiết bị của người khác; quota riêng của tài khoản (5)', async () => {
    const u = await createUser(ctx, { quota: 5 });
    const other = await createUser(ctx);
    const agents = [1, 2, 3, 4, 5].map(() => request.agent(ctx.http));
    let token = '';
    for (const a of agents) { const r = await login(ctx, a, u.email); expect(r.status).toBe(200); token = r.body.access_token; }
    expect((await login(ctx, request.agent(ctx.http), u.email)).status).toBe(403); // thiết bị thứ 6

    const otherLogin = await loginRaw(ctx, other.email);
    const otherDev = (await request(ctx.http).get('/v1/auth/devices').set('Authorization', `Bearer ${otherLogin.access}`)).body.devices[0].id;
    await request(ctx.http).delete(`/v1/auth/devices/${otherDev}`).set('Authorization', `Bearer ${token}`).expect(204);
    expect((await me(ctx, otherLogin.access)).status).toBe(200); // không ảnh hưởng người khác

    const list = (await request(ctx.http).get('/v1/auth/devices').set('Authorization', `Bearer ${token}`)).body.devices;
    const mine = list.find((d: { current: boolean }) => !d.current).id;
    await request(ctx.http).delete(`/v1/auth/devices/${mine}`).set('Authorization', `Bearer ${token}`).expect(204);
    expect((await login(ctx, request.agent(ctx.http), u.email)).status).toBe(200); // đã trống một slot
  });

  describe('kiosk của trung tâm (IP thuộc mạng tin cậy + máy do admin đăng ký)', () => {
    async function setup() {
      const admin = await createUser(ctx, { role: 'admin' });
      const net = await ctx.db.query<{ id: string }>(
        `INSERT INTO trusted_networks (institution_name, cidr) VALUES ('MTA Đà Nẵng', '203.0.113.0/24') RETURNING id`);
      const kioskCookie = randomToken(32);
      const dev = await ctx.db.query<{ id: string }>(
        `INSERT INTO institution_devices (network_id, device_cookie_hash, label, registered_by)
         VALUES ($1, $2, 'Phòng máy 1 – máy 07', $3) RETURNING id`, [net.rows[0].id, sha256Hex(kioskCookie), admin.id]);
      const student = await createUser(ctx, { quota: 1 });
      await loginRaw(ctx, student.email); // đã dùng hết 1 slot thiết bị cá nhân
      const atKiosk = (cookie: string, addr: string) => post(ctx, '/v1/auth/login').set(ip(addr)).set('Cookie', `mta_did=${cookie}`)
        .send({ email: student.email, password: PASSWORD });
      return { student, kioskCookie, kioskDeviceId: dev.rows[0].id, atKiosk };
    }

    it('máy kiosk + IP trung tâm: không tốn quota, đánh dấu kiosk', async () => {
      const { student, kioskCookie, atKiosk } = await setup();
      const res = await atKiosk(kioskCookie, '203.0.113.9');
      expect(res.status).toBe(200);
      expect(res.body.kiosk).toBe(true);
      const personal = await ctx.db.query(
        'SELECT 1 FROM user_devices WHERE user_id = $1 AND revoked_at IS NULL AND institution_device_id IS NULL', [student.id]);
      expect(personal.rowCount).toBe(1); // vẫn chỉ 1 thiết bị cá nhân
      expect((await atKiosk(kioskCookie, '203.0.113.10')).status).toBe(200); // đăng nhập lại: vẫn ổn
    });

    it('cùng cookie kiosk nhưng IP NGOÀI mạng trung tâm: bị tính quota (không thể mang đi dùng ở nhà)', async () => {
      const { kioskCookie, atKiosk } = await setup();
      expect((await atKiosk(kioskCookie, '203.0.113.9')).status).toBe(200);
      const outside = await atKiosk(kioskCookie, '198.51.100.77');
      expect(outside.status).toBe(403);
      expect(outside.body.error.code).toBe('DEVICE_LIMIT_REACHED');
    });

    it('IP trung tâm nhưng cookie KHÔNG phải máy đã đăng ký (laptop cá nhân): vẫn tính quota', async () => {
      const { atKiosk } = await setup();
      const res = await atKiosk(randomToken(32), '203.0.113.9');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('DEVICE_LIMIT_REACHED');
    });

    it('thu hồi máy kiosk → hết được miễn quota', async () => {
      const { kioskCookie, kioskDeviceId, atKiosk } = await setup();
      await ctx.db.query('UPDATE institution_devices SET revoked_at = now() WHERE id = $1', [kioskDeviceId]);
      expect((await atKiosk(kioskCookie, '203.0.113.9')).status).toBe(403);
    });
  });
});

describe('Auth — rate limit đăng nhập (chỉ đếm lần thất bại; nới theo IP trung tâm)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await createTestApp({ LOGIN_FAIL_EMAIL_LIMIT: '3', LOGIN_FAIL_IP_LIMIT: '3', RL_TRUSTED_MULTIPLIER: '10' });
  });
  afterAll(() => ctx.app.close());
  beforeEach(() => resetState(ctx));

  const bad = (email: string, addr: string) => post(ctx, '/v1/auth/login').set(ip(addr)).send({ email, password: 'wrong-password-123' });

  it('3 lần sai cùng email → lần 4 bị 429 kèm Retry-After, kể cả khi mật khẩu đúng', async () => {
    const u = await createUser(ctx);
    for (let i = 0; i < 3; i++) expect((await bad(u.email, '198.51.100.1')).status).toBe(401);
    const res = await post(ctx, '/v1/auth/login').set(ip('198.51.100.1')).send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('đăng nhập thành công làm mới bộ đếm thất bại của email', async () => {
    const u = await createUser(ctx);
    await bad(u.email, '198.51.100.2'); await bad(u.email, '198.51.100.2');
    expect((await post(ctx, '/v1/auth/login').set(ip('198.51.100.2')).send({ email: u.email, password: PASSWORD })).status).toBe(200);
    await bad(u.email, '198.51.100.3'); await bad(u.email, '198.51.100.3');
    expect((await bad(u.email, '198.51.100.4')).status).toBe(401); // chưa bị chặn
  });

  it('theo IP: IP thường bị chặn sau 3 lần sai (khác email); IP trung tâm được nới ×10', async () => {
    for (let i = 0; i < 3; i++) await bad(`x${i}@test.vn`, '198.51.100.50');
    expect((await bad('another@test.vn', '198.51.100.50')).status).toBe(429);

    await ctx.db.query(`INSERT INTO trusted_networks (institution_name, cidr) VALUES ('TT', '203.0.113.0/24')`);
    ctx.network.clearCache();
    for (let i = 0; i < 8; i++) expect((await bad(`y${i}@test.vn`, '203.0.113.20')).status).toBe(401);
  });
});

describe('Auth — kiểm tra Origin (phòng CSRF)', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await createTestApp({ ALLOWED_ORIGINS: 'https://app.minhtri.vn' }); });
  afterAll(() => ctx.app.close());
  beforeEach(() => resetState(ctx));

  it('POST từ Origin lạ bị chặn; Origin hợp lệ và client không phải trình duyệt đi qua', async () => {
    const evil = await post(ctx, '/v1/auth/refresh').set('Origin', 'https://evil.example');
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect((await post(ctx, '/v1/auth/refresh').set('Origin', 'https://app.minhtri.vn')).status).toBe(401); // qua guard, thiếu cookie
    expect((await post(ctx, '/v1/auth/refresh')).status).toBe(401);
    expect(cookieValue(evil, 'mta_rt')).toBeUndefined();
  });
});
