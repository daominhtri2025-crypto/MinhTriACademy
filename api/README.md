# Minh Trí Academy — API (NestJS)

Giai đoạn 1: **Auth** và **Kích hoạt mã (`POST /v1/activate`)**. Thiết kế: [`../docs/DECISIONS.md`](../docs/DECISIONS.md), [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §2.

Chưa có: chấm bài / hàng đợi (giai đoạn 2), sandbox (giai đoạn 3), các module admin. Xem "Chưa hiện thực" bên dưới.

## Chạy

Yêu cầu: Node ≥ 20, PostgreSQL ≥ 15, Redis ≥ 6.

```bash
cd api && npm install
cp .env.example .env            # điền DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, ACTIVATION_PEPPERS
psql "$DATABASE_URL" -f ../db/schema.sql \
  -f ../db/migrations/002_policy_alignment.sql -f ../db/migrations/003_auth_support.sql
npm run build && npm start      # hoặc: npm run start:dev
```

Thiếu/sai cấu hình → tiến trình thoát ngay với thông báo cụ thể (không chạy với giá trị mặc định không an toàn).

## Kiểm thử

```bash
npm test                        # unit (không cần dịch vụ ngoài)
npm run test:int                # tích hợp: PostgreSQL + Redis THẬT, không mock
```

Tích hợp cần: một role PostgreSQL có quyền tạo DB (mặc định `postgres://mta_test:mta_test@localhost:5432/postgres`, đổi bằng
`TEST_DATABASE_ADMIN_URL`) và Redis (mặc định `redis://localhost:6379/15`, DB này bị **FLUSH**; đổi bằng `TEST_REDIS_URL`).
`test/global-setup.js` tạo lại DB `mta_api_test` từ `db/schema.sql` + migrations mỗi lần chạy.

Trạng thái hiện tại: 22 unit + 46 tích hợp. Ngoài ra đã **kiểm tra đột biến thủ công** 14 điểm an ninh then chốt (bỏ ân hạn refresh,
bỏ thu hồi họ khi dùng lại, bỏ yếu tố IP của kiosk, bỏ ràng buộc email, lộ lý do thất bại, đếm cả lần thành công, …): cả 14 đều làm test thất bại.
Lần chạy đầu phát hiện 2 lỗi thật của mã (tên savepoint trùng từ khóa SQL; thứ tự kiểm tra trạng thái/email) và 1 test yếu — đã sửa.

## Endpoint (`/v1`)

| Method | Đường dẫn | Mô tả |
|---|---|---|
| POST | `/auth/register` | Đăng ký (202, phản hồi giống nhau dù email đã tồn tại). Dưới `MINOR_AGE_THRESHOLD` tuổi cần `guardian_email` |
| POST | `/auth/verify-email` · `/auth/resend-verification` | Xác minh email (token một lần, 24 giờ, DB chỉ lưu băm) |
| POST | `/auth/login` | Trả `access_token` (JWT 15') + cookie `mta_rt` (refresh) và `mta_did` (thiết bị), cả hai `httpOnly`, path `/v1/auth` |
| POST | `/auth/refresh` | Xoay vòng refresh token; phát hiện dùng lại; cửa sổ ân hạn cho 2 tab |
| POST | `/auth/logout` | Thu hồi cả họ phiên (hiệu lực tức thời cả với access token còn hạn) |
| GET | `/auth/me` | Hồ sơ cơ bản |
| GET · DELETE | `/auth/devices` · `/auth/devices/:id` | Danh sách / gỡ thiết bị của chính mình |
| POST | `/auth/devices/otp` · `/auth/devices/revoke` | Khi chạm giới hạn thiết bị: OTP email → gỡ thiết bị → đăng nhập lại |
| POST | `/activate` | `{ "code": "MTA-XXXX-XXXX-XXXX" }` — kích hoạt khóa học hoặc gia hạn |

Lỗi luôn có dạng `{ "error": { "code", "message", "details"? } }`; `429` kèm `Retry-After`.

## Quyết định thiết kế đáng chú ý

- **Refresh token:** opaque 256-bit, DB giữ SHA-256. Mỗi lần refresh tạo hàng mới cùng `family_id`. Dùng lại token đã xoay **ngoài** cửa sổ ân hạn
  (`REFRESH_GRACE_SEC`, mặc định 10 giây) ⇒ thu hồi cả họ. **Trong** cửa sổ ân hạn (hai tab refresh đồng thời): chỉ cấp access token, không phát
  refresh mới (cookie trình duyệt đã được tab đến trước cập nhật) ⇒ không phân nhánh họ token. Trần tuyệt đối 90 ngày cho cả họ.
- **Thu hồi tức thời:** access token mang `fid` (họ phiên); thu hồi đặt khóa Redis `revoked:fid:*` (TTL = tuổi access token) và `JwtAuthGuard` kiểm tra mỗi request.
- **Thiết bị:** cookie ngẫu nhiên 256-bit (không fingerprint). Quota theo `users.device_quota` (mặc định 3). **Kiosk** chỉ được miễn quota khi
  *đồng thời* (a) cookie thuộc máy do admin đăng ký (`institution_devices`) và (b) IP hiện tại thuộc đúng mạng của máy đó (`trusted_networks`).
- **Rate limit:** cửa sổ trượt trong Redis (Lua nguyên tử); `status()` kiểm tra trước, `hit()` ghi nhận sau ⇒ **chỉ đếm lần thất bại**.
  IP thuộc mạng tin cậy được nới ×`RL_TRUSTED_MULTIPLIER`.
- **Mã kích hoạt:** HMAC-SHA256 với pepper (hỗ trợ nhiều khóa để xoay); checksum Luhn mod 32; mọi lý do thất bại liên quan tới mã → cùng 404.
- **`TRUST_PROXY`:** chỉ đặt bằng số tầng reverse proxy *của mình*. Đặt sai cho phép giả mạo `X-Forwarded-For` và qua mặt rate limit / mạng tin cậy.

## Chưa hiện thực (cố ý, để các bước sau)

- Gửi email thật: `MailService` là STUB (dev in log; test lưu `outbox`; production chỉ log metadata và **phải** thay bằng nhà cung cấp thật).
- Đặt lại mật khẩu, Google OAuth, phụ huynh "chuyển hồ sơ" sang con, đăng ký máy kiosk (hiện chèn trực tiếp bảng `institution_devices`).
- Admin: sinh/thu hồi lô mã (đã có `generateCode()` + `CodeKeyring` để dùng), khóa/mở tài khoản, `@Roles()` guard.
- "1 phiên học đồng thời" (heartbeat), job dọn `user_sessions` hết hạn, helmet/CORS, đồng ý của phụ huynh.
- Redis ngừng hoạt động ⇒ các endpoint dùng rate limit trả 500 (fail-closed, an toàn nhưng gián đoạn); chưa có chế độ suy giảm.
- Chưa đo độ trễ phản hồi giữa "email không tồn tại" và "sai mật khẩu" (đã cân bằng bằng hash giả nhưng chưa kiểm chứng thực nghiệm).
