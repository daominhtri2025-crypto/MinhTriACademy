# Minh Trí Academy — Đánh giá kiến trúc & Lộ trình tối ưu hóa

> Phạm vi: `ARCHITECTURE.md`, `schema.sql`, prototype `web/` (Next.js 15).
> Quy ước: **[D]** = dữ kiện quan sát trực tiếp trong tài liệu/mã; **[S]** = suy luận kỹ thuật (cần kiểm chứng thực nghiệm).
> Mức ưu tiên: **P0** chặn production · **P1** cần trước khi mở bán · **P2** cải tiến.
> Chưa có backend NestJS trong workspace, nên các nhận định về API/Redis/BullMQ là đánh giá thiết kế, không phải đánh giá mã.

---

## 0. Tóm tắt điều hành

Thiết kế nền tảng đúng hướng: HMAC cho mã kích hoạt, ràng buộc UNIQUE ở tầng DB, ledger EXP idempotent, loại bỏ fingerprinting với trẻ em. Phần yếu nằm ở bốn điểm:

1. **Thực thi code phía client** không có cơ chế dừng (P0).
2. **Lời giải và đáp án** hiện nằm trong DOM/bundle client (P0).
3. **Một số bất nhất nội bộ** giữa tài liệu và schema (§7).
4. **Vòng đời enrollment** chưa hỗ trợ gia hạn và cấp quyền không qua mã (P1).

Về brute-force mã kích hoạt, bài toán không nằm ở entropy (§3.1). Rủi ro thực nằm ở **rò rỉ/mua bán mã** và **rate-limit theo IP làm nghẽn lớp học thật**.

---

## 1. Online IDE & Thực thi code

| # | Phát hiện | Mức |
|---|---|---|
| 1.1 | **[D]** `runPython` chạy `runPythonAsync` trên *main thread* (`app/ide/page.tsx`). `while True:` làm treo tab; cờ `busyRef` không bao giờ được nhả; không có timeout, không có interrupt. | P0 |
| 1.2 | **[D]** Mọi lần chạy dùng chung `py.globals`: biến, import và monkey-patch của lần chạy trước rò sang test case sau. Kết quả "PASS/FAIL" có thể phụ thuộc thứ tự chạy. | P1 |
| 1.3 | **[D]** `out.push` không giới hạn dung lượng: `while True: print("x")` làm cạn bộ nhớ trình duyệt. | P1 |
| 1.4 | **[D]** `TESTS` (kèm `expected`) nằm trong bundle client. Học viên có thể `print(30)` để qua test. | P1 |
| 1.5 | **[D]** Pyodide nạp từ jsDelivr bằng `<script>` không SRI; `next.config.mjs` không có CSP/security headers. Monaco loader mặc định cũng dùng CDN. **[S]** Đây là bề mặt tấn công supply-chain trên trình duyệt trẻ em. | P1 |
| 1.6 | **[D]** Tải ~10 MB ở lần chạy đầu, chặn trải nghiệm trên mạng yếu. | P2 |
| 1.7 | **[D]** Sơ đồ §1.2 vẽ `Worker → PostgreSQL`, trong khi §2.6 nói worker "không cùng mạng với DB". | P1 |
| 1.8 | **[D]** Schema `exercises` thiếu `time_limit_ms`, `memory_limit_kb`, kiểu so khớp output. `expected_stdout` so khớp tuyệt đối sẽ lỗi với khoảng trắng cuối dòng và số thực. | P1 |

### Đề xuất

- **Pyodide trong Web Worker + watchdog.** Chạy trong worker riêng, mỗi lần chạy dùng `globals` mới. Nếu quá 3–5 giây không phản hồi thì `worker.terminate()` và dựng worker mới. Giữ sẵn một worker dự phòng đã nạp Pyodide để độ trễ khôi phục thấp.
  - Cơ chế interrupt mềm (`setInterruptBuffer`) cần `SharedArrayBuffer`, tức cross-origin isolation (COOP/COEP), vốn xung đột với tài nguyên bên thứ ba. Vì vậy `terminate()` là lựa chọn thực dụng hơn.
- **Self-host Pyodide và Monaco** trên origin của mình, `Cache-Control: immutable`, kèm CSP chặt (`script-src 'self'`, `worker-src 'self' blob:`). Tải trước (prefetch) khi người dùng vào `/learn` đến bài coding.
- **Giới hạn output** (ví dụ 64 KB) và cắt phía worker.
- **Phân tách "Chạy thử" và "Nộp bài"**: chạy thử là tiện ích client (không có giá trị điểm); nộp bài luôn đi qua sandbox server với test ẩn (`is_hidden`, `weight` đã có sẵn trong schema).
- **Sandbox server (Java/C++/Python chấm điểm).** Phòng thủ nhiều lớp:
  - Không mạng, rootless; cgroup v2 giới hạn CPU/RAM/PIDs/dung lượng đĩa; seccomp; mỗi lần chạy một môi trường tạm thời.
  - Lớp cô lập mạnh hơn container thuần: gVisor hoặc Firecracker microVM, đặt trên node pool/VPC tách biệt.
  - Phải ghim phiên bản Judge0/Piston đã vá, theo dõi advisory bảo mật (Judge0 CE từng có advisory thoát sandbox **[Cần bổ sung nguồn — kiểm chứng CVE & phiên bản vá]**).
  - Chống "compile bomb" (C++ template, `#include` file đặc biệt) bằng giới hạn thời gian biên dịch riêng; cắt output; kiểm soát fork-bomb qua pids limit.
  - Java: pool JVM ấm để tránh độ trễ khởi động 1–2 giây mỗi lần.
- **Hàng đợi chấm bài:**
  - Giới hạn đồng thời theo người dùng (ví dụ ≤ 1 job đang chạy/exercise) cùng idempotency key để chống double-click.
  - Hạn mức nộp (ví dụ 10/phút/user).
  - Backpressure khi hàng đợi đầy, dead-letter queue, timeout cứng cho job.
  - Autoscale worker theo độ dài hàng đợi.
  - Cache kết quả theo `hash(lang, code, stdin)` cho nút "Chạy thử" server.
- **Luồng ghi kết quả:** worker trả kết quả qua kênh job-result; API (vùng tin cậy) ghi DB. Worker không giữ credential DB, khớp với §2.6.
- **Tái lập kết quả chấm:** lưu `exercise_version` hoặc `test_set_hash` trong `submissions.result`. Sửa test case về sau không làm điểm lịch sử mất nghĩa.

---

## 2. LMS, Gamification & Chính sách lời giải

| # | Phát hiện | Mức |
|---|---|---|
| 2.1 | **[D]** `Accordion` chỉ ẩn bằng `grid-template-rows: 0fr`. Nội dung lời giải **luôn nằm trong DOM**: xem được qua DevTools/View Source; vùng `role="region"` không `hidden`/`inert` nên trình đọc màn hình vẫn đọc. Tài liệu đã thừa nhận đây chỉ là lớp hiển thị. | P0 (khi có dữ liệu thật) |
| 2.2 | **[D]** `quiz.correct` và `explanation` nằm trong bundle client. API thật phải loại bỏ `is_correct` khỏi payload bài trắc nghiệm trước khi nộp. | P0 |
| 2.3 | **[D]** `complete()` tự cộng EXP phía client. Với video/đọc, nút "Đánh dấu hoàn thành" là tự khai. **[S]** Huy hiệu và EXP mất giá trị nếu có thể farm bằng click. | P1 |
| 2.4 | **[D]** Schema không có bảng ghi nhận việc xem gợi ý/lời giải, nên chính sách mở lời giải (§4.3 của tài liệu, chưa chốt) không thể thực thi. | P1 |

### Đề xuất chính sách lời giải (cần bạn quyết, xem §8)

Phương án khuyến nghị: **gợi ý theo bậc + lời giải có điều kiện**.

- Gợi ý 1→3 mở dần (mỗi bậc cách nhau theo thời gian hoặc theo số lần nộp sai).
- Lời giải mở khi **đạt toàn bộ test**, hoặc **sau N lần nộp sai (N=3–5) và ≥ T phút kể từ lần nộp đầu**.
- Xem lời giải trước khi đạt thì EXP bài đó giảm (hoặc 0). Việc này chặn "mở lời giải để đi tắt rồi nhận EXP đầy đủ".
- Cơ sở sư phạm: học qua nỗ lực có cấu trúc (productive failure) **[Cần bổ sung nguồn đầy đủ theo APA 7th]**.
- Triển khai: bảng `exercise_unlocks(user_id, exercise_id, kind ∈ {hint1, hint2, hint3, solution}, unlocked_at)`. Endpoint `GET /exercises/:id/solution` kiểm tra điều kiện phía server; client không bao giờ nhận lời giải trong payload bài học.

### Khác

- **Hoàn thành video/đọc theo bằng chứng:** ngưỡng ≥ 80% thời lượng (dùng `progress.last_position_sec`) hoặc thời gian đọc tối thiểu, xác thực ở server. Bài trắc nghiệm/code chỉ hoàn thành khi server chấm đạt.
- **`exp_ledger`:** ràng buộc `UNIQUE(user_id, reason, ref_id)` **không chống trùng khi `ref_id IS NULL`** (PostgreSQL coi NULL là khác nhau). Dùng `UNIQUE NULLS NOT DISTINCT` (PG ≥ 15, có sẵn ở PG16) hoặc cấm `ref_id` NULL. Cập nhật `users.exp_total` trong cùng transaction với `INSERT` ledger, kèm job đối soát định kỳ.
- **Quiz:** nếu chỉ đơn lựa chọn thì ràng buộc `UNIQUE (question_id) WHERE is_correct`.

---

## 3. Activation Code & Enrollment

### 3.1 Phân tích brute-force (suy luận định lượng)

- **[D]** Entropy thiết kế ≈ 60 bit (12 ký tự Base32). Với giả định 10⁶ mã hợp lệ, xác suất một lần đoán trúng ≈ 10⁶ / 2⁶⁰ ≈ 8,7·10⁻¹³.
- **[S]** Brute-force trực tuyến gần như vô hiệu về mặt toán học, kể cả khi rate limit yếu. Rủi ro thực tế dịch sang:
  - mã bị **chia sẻ/bán lại/chụp màn hình** (CSV plaintext được tải về một lần);
  - **rate-limit theo IP gây chặn nhầm**: 20 lần/giờ/IP chặn một lớp 25 học viên ở cùng NAT của trung tâm kích hoạt đồng thời.

### 3.2 Phát hiện

| # | Phát hiện | Mức |
|---|---|---|
| 3.2.1 | **[D]** `enrollments` có `UNIQUE(user_id, course_id)` và `code_id NOT NULL UNIQUE`. Hệ quả: (a) học viên hết hạn **không thể gia hạn** bằng mã mới (bị 409); (b) không thể cấp quyền thủ công (học thử, bù, hoàn tiền, khóa miễn phí) vì mọi enrollment phải có mã. | P1 |
| 3.2.2 | **[D]** Trạng thái `expired` của mã chỉ được ghi khi có người redeem (lazy), nên dữ liệu admin dashboard lệch với thực tế. | P2 |
| 3.2.3 | **[D]** Không có `hmac_key_id`/phiên bản pepper. Plaintext không lưu nên **không thể xoay pepper** mà không vô hiệu hóa toàn bộ mã tồn kho. | P1 |
| 3.2.4 | **[D]** Cột `failed_attempts` trong schema vô nghĩa: tài liệu đếm lỗi ở Redis, và mã không tồn tại thì không có hàng để đếm. | P2 |
| 3.2.5 | **[D]** §2.3 nói phản hồi "thống nhất" nhưng liệt kê mã HTTP khác nhau (404/409/403/410). Trạng thái khác nhau vẫn là oracle liệt kê. | P2 |
| 3.2.6 | **[D]** Thiếu index: `activation_codes(batch_id)` (xuất/thu hồi theo lô), `(redeemed_by)`, và index một phần cho tác vụ hết hạn. `code_hmac UNIQUE` đã đủ cho đường tra cứu nóng. | P2 |
| 3.2.7 | **[D]** Định dạng `MTA-XXXX-XXXX-XXXX` = 12 ký tự, nhưng §2.1 nói "12 ký tự + 1 checksum" (13). Hoặc entropy thực chỉ ≈ 55 bit, hoặc định dạng sai. | P2 |

### 3.3 Đề xuất

- **Rate limit** (Redis, thực thi nguyên tử bằng Lua/`INCR`+`EXPIRE`, sliding window):
  - Đếm **chỉ các lần thất bại** (không tính checksum sai, không tính thành công).
  - Theo user: 5 thất bại/15 phút, sau đó backoff lũy tiến (1→5→30 phút).
  - Theo IP: ngưỡng cao hơn và tách khỏi giới hạn user (ví dụ 100 thất bại/giờ/IP); khi IP vượt thì yêu cầu Turnstile/CAPTCHA thay vì chặn cứng.
  - Cảnh báo **toàn cục**: tỷ lệ thất bại tăng đột biến (tấn công phân tán). Đây mới là tín hiệu có ích.
  - Ghi `audit_logs` cho mọi mismatch; không tiết lộ lý do trong phản hồi và dùng cùng một mã HTTP + body cho mọi lỗi "mã không dùng được".
- **Chống rò rỉ mã:** tệp CSV mã chỉ tải qua liên kết hết hạn ngắn, có mật khẩu/mã hóa; đánh dấu `exported_at` ở `activation_batches`; thu hồi theo lô; ưu tiên `bound_email` cho kênh bán lẻ.
- **Vòng đời enrollment:**
  - Thêm `source ∈ {code, admin_grant, trial}` và cho phép `code_id NULL` khi `source <> 'code'`.
  - Gia hạn: mã mới với khóa đã có enrollment sẽ **cộng dồn `expires_at`** (hoặc tạo kỳ mới), thay vì trả 409.
  - Nếu giữ lịch sử từng kỳ: bỏ `UNIQUE(user_id, course_id)`, thay bằng chỉ mục duy nhất một phần `WHERE status='active'`.
- **Xoay khóa:** thêm `hmac_key_id smallint`; tra cứu thử theo các khóa còn hiệu lực.
- **Trạng thái hết hạn:** job định kỳ cập nhật `expired`, hoặc coi `expires_at` là nguồn sự thật và dẫn xuất trạng thái qua view.
- **Phục hồi lỗi UNIQUE:** vi phạm `UNIQUE(user_id, course_id)` giữa transaction phải được bắt và ánh xạ thành 409 (rollback bảo toàn trạng thái mã).

---

## 4. Xác thực, phiên & Chống chia sẻ tài khoản

| # | Phát hiện | Mức |
|---|---|---|
| 4.1 | **[S]** **Race khi refresh:** hai tab cùng gửi một refresh token gần như đồng thời. Request thứ hai trông giống "dùng lại token cũ" → bị coi là reuse → thu hồi cả `family_id` → người dùng hợp lệ bị đăng xuất. Cần *grace window* ngắn (10–30 giây) hoặc single-flight phía client. | P1 |
| 4.2 | **[D]** Schema ghi "chỉ token mới nhất hợp lệ" nhưng reuse-detection cần **giữ lại băm token cũ** (hàng đã xoay) để nhận diện. Thiếu cột `rotated_at/replaced_by`, thiếu index `family_id`, thiếu chính sách dọn dẹp. | P1 |
| 4.3 | **[S]** Giới hạn thiết bị bằng cookie: xóa cookie hoặc dùng chế độ ẩn danh sẽ tạo thiết bị "mới", **đốt hết 3 slot** của người dùng hợp lệ và tăng tải hỗ trợ. | P1 |
| 4.4 | **[S]** Cơ chế "đá phiên cũ" có thể gây **vòng đá nhau** nếu hai thiết bị tự kết nối lại. Phiên bị đá nên hiện hộp thoại và **không tự giành lại**. Mất heartbeat do mạng/ngủ máy nên có TTL ≈ 90 giây thay vì kết luận ngay. | P1 |
| 4.5 | **[D]** `user_devices.first_ip/last_ip` là dữ liệu cá nhân, chưa có chính sách lưu giữ. | P2 |
| 4.6 | **[D]** Tài liệu mâu thuẫn: tài liệu §2.4 đề xuất cache quyền truy cập bằng Redis TTL ngắn; thu hồi/khóa tài khoản phải xóa cache ngay, nếu không người dùng bị khóa vẫn truy cập đến hết TTL. | P2 |

### Đề xuất

- Refresh **single-flight** ở client + grace window server cho token vừa xoay.
- Thiết bị: slot "tạm" (ẩn danh) tự hết hạn sau 24 giờ và không tính vào quota; thiết bị tin cậy yêu cầu xác nhận OTP; trang quản lý thiết bị cho phụ huynh.
- Gói **"gia đình"**: quota thiết bị/phiên theo hộ (xem câu hỏi §8), vì anh chị em học chung là tình huống phổ biến với khách hàng mục tiêu.
- Access token (15 phút) giữ trong bộ nhớ; refresh qua cookie `httpOnly`; đặt API cùng *site* với web (subdomain) để dùng `SameSite=Lax/Strict` mà không đánh đổi CSRF. Cân nhắc BFF trong Next.js.
- Cache quyền: xóa chủ động khi khóa/thu hồi/hết hạn, và dùng pub/sub để các instance đồng bộ.

---

## 5. Cơ sở dữ liệu (ngoài §3)

| # | Phát hiện | Mức |
|---|---|---|
| 5.1 | **[D]** Header ghi "UUID v7" nhưng mọi PK dùng `gen_random_uuid()` (v4). PG16 không có v7 gốc. Với bảng lớn (`submissions`, `audit_logs`) v4 làm phân mảnh B-tree. | P2 |
| 5.2 | **[D]** `ON DELETE CASCADE` từ `users` xuống `enrollments`, `submissions`, `progress`…: xóa người dùng sẽ xóa dữ liệu doanh thu/chấm điểm, mâu thuẫn "soft-delete via status". **[S]** Nên ẩn danh hóa (anonymize) thay vì xóa cứng, nhất là cần đáp ứng yêu cầu xóa dữ liệu theo quy định bảo vệ dữ liệu cá nhân **[Cần bổ sung nguồn — xác nhận với pháp chế]**. | P1 |
| 5.3 | **[D]** `classes`/`class_members` không ràng buộc học viên phải có `enrollment` active cho khóa của lớp. Truy cập của giáo viên dựa trên lớp, của học viên dựa trên enrollment, hai nguồn quyền có thể lệch nhau. | P2 |
| 5.4 | **[D]** `submissions.payload` (mã nguồn) không giới hạn kích thước; bảng sẽ tăng nhanh. Cần `CHECK (octet_length(payload::text) < N)`, phân vùng theo tháng, chính sách lưu giữ. | P1 |
| 5.5 | **[D]** `mv_monthly_activation` không có chỉ mục duy nhất, nên không thể `REFRESH ... CONCURRENTLY`. `v_course_completion` là view thường nhân `enrollments × lessons`, sẽ chậm khi dữ liệu lớn. | P2 |
| 5.6 | **[D]** `audit_logs` chưa được bảo vệ append-only (thu hồi quyền `UPDATE/DELETE`, hoặc trigger); chưa phân vùng. | P2 |
| 5.7 | **[D]** `leads.kind/status` là `text` tự do (nên enum/CHECK); không có `consent_at`, phiên bản nội dung đồng ý; không có chống spam (honeypot/CAPTCHA/rate limit); `LeadForm` hiện chưa gửi đi đâu. | P1 |
| 5.8 | **[D]** Dữ liệu trẻ em: có `guardian_email` nhưng không có trạng thái xác minh/đồng ý của người giám hộ. | P1 |
| 5.9 | **[D]** Comment trong schema tham chiếu sai mục (ví dụ "ARCHITECTURE §3" cho chống chia sẻ, thực tế là §2.5). | P2 |

---

## 6. Hạ tầng & Vận hành

- **Redis đa vai trò** (rate limit, heartbeat, cache, BullMQ): BullMQ yêu cầu `maxmemory-policy noeviction`, trong khi cache cần eviction. **Tách thành hai instance/logical cluster**, nếu không cache có thể đẩy mất job hoặc job làm đầy cache.
- Thiếu trong tài liệu: công cụ migration (Prisma/TypeORM/Flyway), chiến lược backup + PITR, quan sát (log có cấu trúc, tracing, SLO cho độ trễ chấm bài), CI với test tích hợp trên PostgreSQL thật, kiểm thử tải cho đường chấm bài và redeem.
- **Video:** signed URL TTL 5–10 phút phải kèm cơ chế làm mới token giữa phiên (HLS dài); URL vẫn chia sẻ được trong TTL, đây là giới hạn đã chấp nhận.
- **Hiệu năng frontend:** bundle Monaco lớn → tải động đã đúng; thêm prefetch theo ý định, và cache Service Worker cho Pyodide/Monaco.

---

## 7. Danh sách bất nhất cần sửa trong tài liệu

1. Sơ đồ §1.2 (`Worker → PG`) ↔ §2.6 (worker khác mạng với DB).
2. §2.1 (12 + 1 ký tự) ↔ định dạng `MTA-XXXX-XXXX-XXXX` (12 ký tự).
3. §2.3 (phản hồi thống nhất) ↔ mã HTTP khác nhau 404/403/409/410.
4. Schema `failed_attempts` ↔ §2.3 (đếm ở Redis).
5. Header schema "UUID v7" ↔ `gen_random_uuid()` (v4).
6. Comment schema trỏ sai mục (§3 ↔ §2.5; §2 ↔ §2.4).
7. README ghi chấm 3 test **ở client**; §3 nói client không bao giờ là nguồn tin cậy cho điểm. Cần ghi rõ prototype chỉ minh họa.

---

## 8. Lộ trình ưu tiên

| Giai đoạn | Hạng mục |
|---|---|
| **P0 — trước mọi dữ liệu thật** | Worker + watchdog cho Pyodide; bỏ lời giải/đáp án khỏi payload client (endpoint có chính sách); sandbox server cho mọi việc chấm điểm; CSP + self-host thư viện |
| **P1 — trước khi mở bán** | Vòng đời enrollment (gia hạn, cấp thủ công); rate limit đúng loại và theo hai tầng; grace window refresh; `exercise_unlocks`; chính sách lưu giữ/ẩn danh dữ liệu; đồng ý của phụ huynh; chống spam `leads`; tách Redis |
| **P2 — tối ưu** | `hmac_key_id`, chỉ mục bổ sung, phân vùng `submissions`/`audit_logs`, `REFRESH CONCURRENTLY`, UUID v7, sửa bất nhất tài liệu |

---

## 9. Câu hỏi cần thống nhất trước khi triển khai

1. **Chính sách lời giải:** chọn một: (a) sau khi đạt; (b) sau N lần sai + T phút; (c) gợi ý theo bậc. EXP có bị giảm khi xem lời giải không?
2. **Mô hình truy cập:** có bán gia hạn không? Có cần cấp quyền thủ công/học thử không? (Quyết định schema `enrollments`.)
3. **Gia đình/trung tâm:** quota 3 thiết bị và 1 phiên đồng thời có áp dụng cho tài khoản nhiều con không? Học viên tại trung tâm có dùng chung NAT không? (Quyết định ngưỡng rate limit theo IP.)
4. **Tiêu chí đánh giá IDE:** mục tiêu độ trễ chấm bài (p95) và tải đồng thời đỉnh (ví dụ cả lớp nộp cùng lúc) để cỡ hóa worker/sandbox.
5. **So khớp output:** chấp nhận chuẩn hóa khoảng trắng/dung sai số thực hay bắt buộc khớp tuyệt đối?
6. **Mức cô lập sandbox:** tự vận hành (gVisor/Firecracker) hay thuê dịch vụ thực thi code? Ảnh hưởng chi phí và trách nhiệm vá lỗi.
7. **Pháp lý dữ liệu trẻ em:** ngưỡng tuổi và hình thức đồng ý của người giám hộ **[Cần bổ sung nguồn — xác nhận với pháp chế]**.
