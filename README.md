# Minh Trí Academy — Design + Prototype

- `docs/ARCHITECTURE.md` — Tech stack, RBAC, ERD, luồng Activation Code, chống chia sẻ tài khoản, thiết kế IDE
- `db/schema.sql` — PostgreSQL DDL (users, courses, lessons, activation_codes, enrollments, submissions, progress, badges, ...)
- `web/` — Prototype Next.js 15 (App Router) + Tailwind

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
