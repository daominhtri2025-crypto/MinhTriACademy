# Minh Trí Academy — Sổ quyết định thiết kế (ADR)

> Nguồn: các quyết định của chủ dự án (lượt trao đổi hiện tại) + phản biện kỹ thuật.
> Hiện thực hóa tại: [`db/migrations/002_policy_alignment.sql`](../db/migrations/002_policy_alignment.sql), kiểm thử: [`db/tests/`](../db/tests/).
> Quy ước: **[Chốt]** = quyết định của chủ dự án · **[Điều chỉnh]** = thay đổi/bổ sung do phản biện, cần xác nhận · **[D]** dữ kiện · **[S]** suy luận.

| ADR | Chủ đề | Trạng thái |
|---|---|---|
| 001 | Gợi ý theo bậc, lời giải, EXP | Chốt + 2 điều chỉnh |
| 002 | Kích hoạt / gia hạn / cấp thủ công / học thử | Chốt + 1 điều chỉnh |
| 003 | Trung tâm (IP/NAT) & gia đình | Chốt + 2 điều chỉnh |
| 004 | Sandbox tự vận hành | Chốt + điều kiện kiểm chứng |
| 005 | Tải đỉnh & độ trễ | Chốt, **SLO cần phân tầng** |

---

## ADR-001 — Gợi ý, lời giải mẫu, EXP

**[Chốt]**
- Tối đa 3 mức gợi ý, từ nhẹ đến chi tiết; không phạt EXP, hiển thị nhắc nhở tự suy nghĩ.
- Lời giải mở khóa khi: ≥ 3 lần nộp sai **hoặc** ≥ 10 phút trên bài tập.
- Xem lời giải: EXP thưởng của bài học bị trừ 50%.

**[Điều chỉnh] cần xác nhận**
1. **"10 phút" đo thế nào?** Đồng hồ treo tường (mở bài rồi để đó) làm điều kiện này vô nghĩa. Thiết kế: cộng dồn `exercise_attempts.active_seconds` từ heartbeat 30 giây, **server kẹp ≤ 60 giây mỗi lần** (client không thể "bơm" thời gian). Ngưỡng nằm ở `exercises.solution_unlock_seconds` (mặc định 600).
2. **"3 lần sai" đếm thế nào?** Đếm **số mã nguồn khác nhau** (`code_sha256`) bị chấm sai, loại lỗi hạ tầng (`verdict='system_error'`). Nếu không, bấm nộp cùng một mã ba lần là mở được lời giải.
3. **Bổ sung:** học viên *đã đạt* được xem lời giải để đối chiếu, **không bị phạt** (phạt chỉ áp dụng nếu xem lời giải *trước* khi đạt). Nếu bạn muốn khóa cả sau khi đạt, bỏ điều kiện `passed_at IS NOT NULL` trong view `v_solution_eligibility`.

**Thiết kế** (đã kiểm thử)

| Thành phần | Vai trò |
|---|---|
| `exercise_hints(level 1..3)` | Thay `exercises.hint_md` (dữ liệu cũ chuyển thành mức 1) |
| `exercise_attempts` | 1 hàng / (học viên, bài tập): `first_opened_at`, `active_seconds`, `hint_level`, `solution_viewed_at`, `passed_at` |
| `open_hint(user, exercise, level)` | Bắt buộc mở tuần tự 1→2→3; từ chối mức > 3 |
| `view_solution(user, exercise)` | Chỉ trả lời giải khi `v_solution_eligibility.eligible`; ghi nhận lần xem đầu |
| `lesson_exp_award(user, lesson)` | `floor(exp_reward × 0.5)` nếu có bài tập có lời giải được xem trước khi đạt; ngược lại đủ EXP |

Quy tắc phụ: xem gợi ý không ảnh hưởng EXP (kiểm thử khẳng định). Với bài học nhiều bài tập, chỉ cần một bài bị xem lời giải trước khi đạt là cả bài học nhận 50% (diễn giải "EXP của bài học đó").

**Hệ quả:** thông báo nhắc nhở và bộ đếm "còn X lần / Y phút để mở lời giải" thuộc UI; số liệu gợi ý/lời giải theo học viên là tín hiệu để giáo viên nhận ra học viên đang gặp khó.

---

## ADR-002 — Kích hoạt, gia hạn, cấp thủ công, học thử

**[Chốt]** Hỗ trợ đầy đủ: học thử (Chương 1 của Scratch và Python cơ bản, không cần mã); admin cấp quyền trực tiếp (học viên đóng học phí tại trung tâm ở Đà Nẵng); gia hạn bằng mã bổ sung, giữ nguyên `progress` và `submissions`.

**Thiết kế** (đã kiểm thử)

- **Sổ cái `enrollment_grants`**: mỗi lần cấp quyền là một hàng (`source ∈ {code, admin_grant}`, `is_extension`, `days_granted`, `starts_at/ends_at`, `price_paid_vnd`, `granted_by`, `note`). `enrollments` vẫn **một hàng / (user, course)** và chỉ giữ `expires_at` tổng hợp ⇒ gia hạn không đụng tới `progress`/`submissions`.
  - Ràng buộc "1 mã ↔ 1 lần cấp" chuyển thành `enrollment_grants.code_id UNIQUE`.
  - `enrollments.code_id` và `price_paid_vnd` bị bỏ; dữ liệu cũ được chuyển vào sổ cái (kiểm thử backfill). Doanh thu theo kỳ lấy từ sổ cái (`mv_monthly_activation` tách `activations/extensions/admin_grants`, có chỉ mục duy nhất để `REFRESH CONCURRENTLY`).
- **Mã gia hạn:** `activation_codes.kind ∈ {activation, extension}`, `grant_days` (ghi đè `courses.duration_days`).
- **Điểm vào duy nhất `grant_access(...)`**, chạy trong transaction redeem:
  - gia hạn cộng từ `max(now, expires_at)` (hết hạn thì tính từ hiện tại);
  - mã gia hạn khi chưa có enrollment → `NO_ENROLLMENT_TO_EXTEND`; enrollment vĩnh viễn → `ALREADY_LIFETIME`; lỗi **không đốt mã** (rollback);
  - an toàn với đua giao dịch (`ON CONFLICT` rồi xử lý như gia hạn);
  - cấp thủ công bắt buộc có admin, ghi `note` (ví dụ "Thu học phí tại trung tâm").
- **Học thử:** cờ `chapters.is_free_preview` (hạt giống: chương đầu của các khóa có slug `scratch`, `python`; hàm `can_access_lesson`). Tiến độ làm trong thời gian học thử được giữ khi học viên sau đó mua khóa vì dùng chung `user_id`/`lesson_id`.

**[Điều chỉnh] cần xác nhận**
- **Học thử yêu cầu đăng nhập + xác minh email**, không cho truy cập ẩn danh hoàn toàn. Lý do: bài code trong chương học thử tiêu tốn tài nguyên sandbox và video tốn băng thông; ẩn danh không có đối tượng để giới hạn tốc độ hay chặn lạm dụng. Nếu muốn xem video ẩn danh, đó là một đường riêng, không gồm nộp bài.
- Xác nhận `slug` thực tế của hai khóa học thử (migration dùng `scratch` và `python` theo dữ liệu mẫu).

**Chưa quyết (nhỏ):** giá của mã gia hạn; có cho gia hạn khóa vĩnh viễn như "tặng thêm" hay không (hiện từ chối).

---

## ADR-003 — Trung tâm (IP/NAT) và gia đình

**[Chốt]** Đánh dấu dải IP trung tâm là *Trusted Institution IP* để nhiều học viên dùng song song trong phòng máy; gia đình dùng quota thông minh hoặc tách hồ sơ từng bé (`child_profile_id`).

**Phân tích điều kiện**
- **[D]** Giới hạn thiết bị và phiên học hiện tính **theo tài khoản**. Nhiều tài khoản khác nhau trên cùng IP không tự kích hoạt khóa phiên; thứ bị ảnh hưởng thật sự là (a) rate limit theo IP (20 lần/giờ/IP) và (b) quota thiết bị khi nhiều học viên đăng nhập trên **cùng một máy phòng lab** (mỗi học viên đốt 1 slot trong 3 slot của mình vào máy chung).
- **[S] Rủi ro của "tin IP":** nếu IP của trung tâm là động hoặc nằm sau CGNAT của nhà mạng, danh sách tin cậy sẽ vô tình miễn trừ cả những người ngoài. Cần xác nhận trung tâm có **IP tĩnh công cộng độc quyền** trước khi bật.

**Thiết kế (đã kiểm thử)**
- `trusted_networks(cidr, relax_ip_rate_limit)`: **chỉ nới rate limit theo IP**.
- **[Điều chỉnh] Miễn quota thiết bị cần yếu tố thứ hai:** `institution_devices` — máy kiosk do admin đăng ký (cookie thiết bị riêng), chỉ hợp lệ khi IP thuộc mạng tin cậy. `user_devices.institution_device_id` đánh dấu phiên trên máy kiosk; quota chỉ đếm thiết bị còn lại (`idx_devices_quota`). Lý do: nếu chỉ dựa IP, học viên mang laptop cá nhân vào trung tâm sẽ đăng ký thiết bị "miễn quota" rồi dùng mãi ở nhà.
- **[Điều chỉnh] Gia đình — chọn phương án tách hồ sơ, hiện thực bằng tài khoản riêng cho từng bé** thay vì thêm tầng `child_profile_id` bên trong một tài khoản:
  - `users.is_managed` + `username` (bé nhỏ không cần email), vai trò mới `guardian`, bảng `guardian_links`, `user_sessions.acting_guardian_id` để truy vết khi phụ huynh chuyển hồ sơ.
  - Lý do: `progress`, `submissions`, `exp_ledger`, `enrollments` đều khóa theo `user_id`; thêm tầng hồ sơ sẽ buộc đổi khóa của toàn bộ chuỗi bảng. Tài khoản riêng còn giúp ràng buộc mã 1-1, "1 phiên học đồng thời" và quota thiết bị hoạt động đúng cho từng bé (một iPad dùng chung chỉ tốn một slot cho mỗi bé).
  - **Quota 5 thiết bị** vẫn có thể dùng như ngoại lệ do admin đặt: `users.device_quota` (1–10, mặc định 3). Riêng quota 5 không giải quyết hai vấn đề thật của "một tài khoản, nhiều bé": tiến độ/EXP bị trộn, và 1 phiên học đồng thời sẽ đá anh chị em.
- Đối chiếu `bound_email` cho tài khoản được quản lý: so với email của một trong các phụ huynh trong `guardian_links`.

**Cần xác nhận:** IP tĩnh của trung tâm; chấp nhận quy trình đăng ký máy kiosk (một lần cho mỗi máy); phương án tài khoản riêng cho từng bé.

**Chưa hiện thực trong migration (thuộc lớp ứng dụng):** luồng phụ huynh chuyển hồ sơ, xác minh phụ huynh/đồng ý, trang quản lý thiết bị, tra cứu IP ∈ CIDR từ chuỗi proxy tin cậy (chỉ tin `X-Forwarded-For` từ proxy của mình).

---

## ADR-004 — Sandbox tự vận hành

**[Chốt]** Tự vận hành sandbox container (Piston hoặc Judge0 bản nhẹ) trên VPS riêng, để kiểm soát chi phí cố định và dữ liệu, không phụ thuộc hạn mức API bên thứ ba.

**Phản biện cần ghi nhận**
- **Không có "an toàn tuyệt đối".** Tự vận hành chuyển trách nhiệm vá lỗi và cô lập sang trung tâm. Cả Piston và Judge0 dựa trên `isolate` và thường yêu cầu container có đặc quyền cao **[Cần kiểm chứng trên tài liệu chính thức của phiên bản được chọn]**; nghĩa là thoát sandbox có thể dẫn tới quyền root trên host.
- Vì vậy yêu cầu tối thiểu: **VPS riêng chỉ để chấm bài**, không chứa bí mật nào, không có đường mạng tới DB/Redis ngoài kênh nội bộ có xác thực, đầu ra (egress) bị chặn toàn bộ, dựng lại được bằng IaC (coi như dùng một lần), cập nhật kernel/phiên bản sandbox định kỳ và theo dõi advisory bảo mật **[Cần bổ sung nguồn]**.
- **Dữ liệu học viên không rời vùng tin cậy:** sandbox chỉ nhận `(mã nguồn, stdin, giới hạn)`; không có tên, email, ID người dùng. Điều này mới là điều kiện thực chất cho "bảo mật dữ liệu học viên", hơn là việc tự vận hành.
- **Chọn engine bằng benchmark, không chọn theo cảm tính** (xem `GRADING_PIPELINE.md` §4): vấn đề lớn nhất với mục tiêu độ trễ là **biên dịch một lần, chạy nhiều test**. Một lần gọi Piston/Judge0 thường tương ứng một lần chạy; nếu mỗi test case biên dịch lại thì Java/C++ không đạt SLO **[S — cần đo]**. Phương án dự phòng: runner mỏng tự viết trên `isolate` (biên dịch một lần, chạy tuần tự các test).

Đã chuẩn bị ở tầng dữ liệu: `exercises.time_limit_ms / memory_limit_kb / compile_limit_ms / compare_mode / float_eps`, `submissions.test_set_hash` (tái lập kết quả), `submissions.verdict` (phân loại, tách `system_error`).

---

## ADR-005 — Tải đỉnh và độ trễ chấm bài

**[Chốt]** p95 < 2 giây; chịu được 30–50 học sinh nộp trong 1 phút; dùng Redis + BullMQ để xếp hàng.

**[Điều chỉnh] SLO phải phân tầng theo ngôn ngữ và hình dạng tải.** "30–50 bài trong 1 phút" chỉ ≈ 0,8 yêu cầu/giây nếu trải đều, nhưng nếu giáo viên nói "nộp bài" thì thực tế là **50 bài trong vài giây**. Hai kịch bản đòi hỏi năng lực khác nhau hai bậc độ lớn (tính toán ở `GRADING_PIPELINE.md` §3, giả định [S] cần đo).

| Tầng | Mục tiêu đề xuất | Điều kiện |
|---|---|---|
| Python | p95 < 2 s | Cả lớp nộp đồng thời (50 bài / vài giây) |
| C++ | p95 < 3 s | Nộp trải đều; < 8 s khi nộp đồng thời |
| Java | p95 < 5 s | Nộp trải đều; < 15 s khi nộp đồng thời |

Lý do: thời gian phục vụ một bài Java (biên dịch + khởi động JVM + chạy test) đã gần hoặc vượt 2 giây dù không có hàng đợi; chỉ có thể đạt p95 < 2 s với Java nếu chạy các test song song và cấp rất nhiều lõi **[S]**.

Các đòn bẩy giảm tải đã nằm trong thiết kế: nút "Chạy thử" Python chạy ở client (chỉ "Nộp bài" tới server); cache kết quả theo `(test_set_hash, code_sha256)`; `idempotency_key` chống bấm đúp; hàng đợi theo ngôn ngữ để tác vụ nặng không chặn tác vụ nhẹ; hiển thị vị trí hàng đợi qua SSE.

---

## Việc còn lại từ báo cáo đánh giá (chưa nằm trong migration 002)

Chưa xử lý, vẫn mở: `hmac_key_id` (xoay pepper), rate limit redeem hai tầng và theo lần thất bại, grace window cho refresh token, chính sách ẩn danh hóa thay cho `ON DELETE CASCADE`, đồng ý của phụ huynh, chống spam `leads`, tách Redis hàng đợi/cache, phân vùng `submissions`/`audit_logs`, sửa các bất nhất tài liệu (§7 báo cáo). Xem [`ARCHITECTURE_REVIEW.md`](ARCHITECTURE_REVIEW.md).

## Điểm cần bạn xác nhận (tổng hợp)

1. Xem lời giải sau khi đạt: **miễn phạt và cho xem** (đề xuất) hay khóa?
2. Học thử **bắt buộc đăng nhập + xác minh email** (đề xuất)?
3. "10 phút" = **thời gian làm bài tích lũy qua heartbeat** (đề xuất), không phải đồng hồ treo tường?
4. IP trung tâm có phải **IP tĩnh độc quyền**? Chấp nhận **đăng ký máy kiosk** làm yếu tố thứ hai?
5. Gia đình: **tài khoản riêng từng bé + liên kết phụ huynh** (đề xuất) thay vì một tài khoản chung?
6. SLO phân tầng như bảng ADR-005 có chấp nhận được không, hay muốn ngân sách phần cứng để Java cũng đạt p95 < 2 s?
