# Minh Trí Academy — Design + Prototype

- `docs/ARCHITECTURE.md` — Tech stack, RBAC, ERD, luồng Activation Code, chống chia sẻ tài khoản, thiết kế IDE
- `db/schema.sql` — PostgreSQL DDL (users, courses, lessons, activation_codes, enrollments, submissions, progress, badges, ...)
- `db/migrations/002_policy_alignment.sql` — hiện thực hóa các quyết định (gợi ý/lời giải, gia hạn/cấp thủ công/học thử, trung tâm & gia đình, siêu dữ liệu chấm bài)
- `db/tests/` — kiểm thử migration trên PostgreSQL ≥ 15 (`run_002.sh`)
- `docs/DECISIONS.md` — sổ quyết định (ADR-001…005) và các điểm cần xác nhận
- `docs/GRADING_PIPELINE.md` — pipeline chấm bài, sandbox, mô hình năng lực, kế hoạch benchmark
- `docs/ARCHITECTURE_REVIEW.md` — đánh giá kiến trúc, điểm nghẽn, lộ trình tối ưu
- `web/` — Prototype Next.js 15 (App Router) + Tailwind

## Kiểm thử cơ sở dữ liệu
```bash
# cần PostgreSQL >= 15 đang chạy và quyền tạo database tạm
sudo -u postgres db/tests/run_002.sh   # in "ALL 002 TESTS PASSED" nếu đạt
```

## Chạy prototype
```bash
cd web && npm install && npm run dev   # http://localhost:3000
```
Routes: `/` Trang chủ · `/learn` LMS · `/ide` Online IDE

## Trạng thái thực thi
| Thành phần | Mức |
|---|---|
| Python trong IDE | Chạy thật (Pyodide, CDN, main thread) + chấm 3 test case ở client |
| Java / C++ | MOCK (output cố định, gắn nhãn) |
| Scratch | Mô phỏng repeat/move/turn/say bằng SVG |
| Dữ liệu, giá, giảng viên | Placeholder (lib/data.ts) |
