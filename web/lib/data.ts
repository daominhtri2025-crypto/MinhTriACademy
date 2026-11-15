// DỮ LIỆU MẪU (demo) — thay bằng API NestJS khi tích hợp. Số liệu/giá/nhận xét chỉ là placeholder.

export const courses = [
  { slug: "scratch", title: "Scratch Sáng Tạo", age: "6–10 tuổi", topics: 24, price: 1_500_000, color: "from-amber-300 to-orange-400", icon: "🧩", desc: "Làm quen tư duy lập trình qua kéo-thả khối lệnh, tự làm game và hoạt hình." },
  { slug: "python", title: "Python Từ Con Số 0", age: "10+ tuổi", topics: 36, price: 2_400_000, color: "from-emerald-300 to-green-500", icon: "🐍", desc: "Biến, vòng lặp, hàm, cấu trúc dữ liệu và dự án nhỏ có thể trình diễn." },
  { slug: "java", title: "Java Căn Bản & OOP", age: "13+ tuổi", topics: 40, price: 2_900_000, color: "from-sky-300 to-blue-500", icon: "☕", desc: "Lập trình hướng đối tượng chuẩn mực, nền tảng cho đại học và đi làm." },
  { slug: "cpp", title: "C++ & Giải Thuật", age: "13+ tuổi", topics: 44, price: 3_200_000, color: "from-violet-300 to-indigo-500", icon: "⚙️", desc: "Cấu trúc dữ liệu, thuật toán, luyện đề tin học và thi học sinh giỏi." },
  { slug: "web", title: "Web Cho Người Mới", age: "12+ tuổi", topics: 30, price: 2_600_000, color: "from-pink-300 to-rose-500", icon: "🌐", desc: "HTML, CSS, JavaScript — tự tay xây trang web cá nhân đầu tiên." },
  { slug: "algo", title: "Tư Duy Thuật Toán", age: "Mọi lứa tuổi", topics: 28, price: 2_200_000, color: "from-teal-300 to-cyan-500", icon: "🧠", desc: "Rèn tư duy giải quyết vấn đề độc lập với ngôn ngữ lập trình." },
];

export const teachers = [
  { name: "Giảng viên A", role: "Trưởng chuyên môn · Python/AI", emoji: "👨‍🏫" },
  { name: "Giảng viên B", role: "Scratch & Tư duy sáng tạo", emoji: "👩‍🏫" },
  { name: "Giảng viên C", role: "Java/C++ · Luyện thi học sinh giỏi", emoji: "🧑‍💻" },
];

export const news = [
  { tag: "Học tập", title: "Nên bắt đầu học lập trình từ Scratch hay Python?", date: "12/11/2026" },
  { tag: "Phụ huynh", title: "5 dấu hiệu con bạn sẵn sàng học lập trình", date: "05/11/2026" },
  { tag: "Trung tâm", title: "Khai giảng các lớp Python & C++ tháng 12", date: "28/10/2026" },
];

export const testimonials = [
  { quote: "Con tự làm được game đầu tiên sau 6 buổi.", who: "Phụ huynh học viên (mẫu)" },
  { quote: "Lộ trình rõ ràng, thầy cô nhận xét tiến độ chi tiết.", who: "Phụ huynh học viên (mẫu)" },
  { quote: "Giao diện học và IDE tiện, không cần cài đặt gì.", who: "Học viên (mẫu)" },
];

export type LessonItem = {
  id: string; title: string; type: "video" | "reading" | "quiz" | "coding"; minutes: number; done?: boolean;
};
export type Chapter = { id: string; title: string; lessons: LessonItem[] };

export const syllabus: Chapter[] = [
  { id: "c1", title: "Chương 1 · Làm quen với Python", lessons: [
    { id: "l1", title: "Python là gì? Cài đặt & chạy chương trình đầu tiên", type: "video", minutes: 8, done: true },
    { id: "l2", title: "Biến và kiểu dữ liệu", type: "reading", minutes: 6, done: true },
    { id: "l3", title: "Kiểm tra nhanh: Biến", type: "quiz", minutes: 5, done: true },
  ]},
  { id: "c2", title: "Chương 2 · Điều kiện & Vòng lặp", lessons: [
    { id: "l4", title: "Câu lệnh if – else", type: "video", minutes: 10, done: true },
    { id: "l5", title: "Vòng lặp for và range()", type: "video", minutes: 12 },
    { id: "l6", title: "Bài tập: Tổng các số chẵn từ 1 đến N", type: "coding", minutes: 15 },
    { id: "l7", title: "Kiểm tra: Vòng lặp", type: "quiz", minutes: 5 },
  ]},
  { id: "c3", title: "Chương 3 · Hàm", lessons: [
    { id: "l8", title: "Định nghĩa và gọi hàm", type: "video", minutes: 11 },
    { id: "l9", title: "Bài tập: Hàm kiểm tra số nguyên tố", type: "coding", minutes: 20 },
  ]},
];

export const quiz = {
  question: "Đoạn code `for i in range(3): print(i)` in ra kết quả nào?",
  options: ["1 2 3", "0 1 2", "0 1 2 3", "3 2 1"],
  correct: 1,
  explanation: "range(3) sinh dãy 0, 1, 2 (không bao gồm 3).",
};

export const starters: Record<string, { label: string; monaco: string; code: string }> = {
  python: { label: "Python", monaco: "python", code: `# Tổng các số chẵn từ 1 đến n\nn = int(input())\ntotal = 0\nfor i in range(1, n + 1):\n    if i % 2 == 0:\n        total += i\nprint(total)\n` },
  scratch: { label: "Scratch", monaco: "plaintext", code: `when green flag clicked\ngo to x: 0 y: 0\nrepeat 10\n  move 10 steps\n  turn 36 degrees\nend\nsay "Xin chào, Minh Trí Academy!" for 2 seconds\n` },
  java: { label: "Java", monaco: "java", code: `public class Main {\n    public static void main(String[] args) {\n        int n = 10, total = 0;\n        for (int i = 1; i <= n; i++) {\n            if (i % 2 == 0) total += i;\n        }\n        System.out.println(total);\n    }\n}\n` },
  cpp: { label: "C++", monaco: "cpp", code: `#include <iostream>\nusing namespace std;\n\nint main() {\n    int n = 10, total = 0;\n    for (int i = 1; i <= n; i++) {\n        if (i % 2 == 0) total += i;\n    }\n    cout << total << endl;\n    return 0;\n}\n` },
};

export const vnd = (n: number) => n.toLocaleString("vi-VN") + "đ";
