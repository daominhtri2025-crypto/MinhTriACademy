import Link from "next/link";
import { courses, news, teachers, testimonials, vnd } from "@/lib/data";
import { LeadForm } from "@/components/LeadForm";
import { Footer } from "@/components/Footer";

const stats = [
  { v: "6", l: "Khóa học" },
  { v: "4", l: "Ngôn ngữ: Scratch · Python · Java · C++" },
  { v: "1-1", l: "Kèm cặp theo lớp" },
  { v: "24/7", l: "Học mọi nơi" },
];

const reasons = [
  { i: "🎯", t: "Lộ trình cá nhân hóa", d: "Test năng lực đầu vào để xếp đúng khóa, đúng tốc độ." },
  { i: "👩‍🏫", t: "Giảng viên kèm sát", d: "Chấm bài, điểm danh, nhận xét tiến độ gửi phụ huynh." },
  { i: "🎮", t: "Học như chơi game", d: "Tích EXP, mở huy hiệu, giữ chuỗi ngày học." },
  { i: "💻", t: "Online IDE tích hợp", d: "Viết và chạy code ngay trên trình duyệt, không cần cài đặt." },
];

export default function HomePage() {
  return (
    <main>
      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800">
              ✨ Khai giảng liên tục · Học thử miễn phí
            </span>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight text-slate-900 md:text-5xl">
              Lập trình không khó —<br />
              <span className="text-brand-600">chỉ cần đúng người dẫn đường.</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-slate-600">
              Minh Trí Academy đào tạo Scratch, Python, Java và C++ cho trẻ em, học sinh và người mới bắt đầu, với LMS gamification và Online IDE ngay trên trình duyệt.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="#khoa-hoc" className="btn-primary">Khám phá khóa học</Link>
              <Link href="#tu-van" className="btn-ghost">Đăng ký test năng lực</Link>
              <Link href="/learn" className="btn-ghost">▶ Học thử LMS</Link>
            </div>
            <dl className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.l}>
                  <dt className="text-2xl font-extrabold text-brand-700">{s.v}</dt>
                  <dd className="text-xs text-slate-500">{s.l}</dd>
                </div>
              ))}
            </dl>
          </div>
          {/* Visual: code-card */}
          <div className="relative mx-auto w-full max-w-md">
            <div className="absolute -right-4 -top-4 grid h-16 w-16 rotate-12 place-items-center rounded-2xl bg-sun-400 text-3xl shadow-lg">🏆</div>
            <div className="card overflow-hidden shadow-xl">
              <div className="flex items-center gap-1.5 bg-slate-900 px-4 py-2.5">
                <span className="h-3 w-3 rounded-full bg-red-400" /><span className="h-3 w-3 rounded-full bg-yellow-400" /><span className="h-3 w-3 rounded-full bg-green-400" />
                <span className="ml-3 text-xs text-slate-400">hello.py</span>
              </div>
              <pre className="bg-slate-950 p-5 text-sm leading-relaxed text-slate-100"><code>{`for ban in ["Mai", "Nam", "Lan"]:
    print(f"Chào {ban}, hãy cùng code nào! 🚀")

exp = 0
exp += 50  # +50 EXP khi hoàn thành bài
print("EXP:", exp)`}</code></pre>
              <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-4 py-3 text-xs text-slate-300">
                <span>✔ Chạy thành công</span><span className="rounded-full bg-brand-600 px-2 py-0.5 font-semibold text-white">+50 EXP</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COURSES */}
      <section id="khoa-hoc" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16">
        <h2 className="text-3xl font-extrabold">Khóa học nổi bật</h2>
        <p className="mt-2 text-slate-600">Từ khối lệnh kéo-thả đến thuật toán nâng cao — chọn theo độ tuổi và mục tiêu.</p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <article key={c.slug} className="card group overflow-hidden transition hover:-translate-y-1 hover:shadow-lg">
              <div className={`flex h-28 items-center justify-center bg-gradient-to-br ${c.color} text-5xl`}>{c.icon}</div>
              <div className="p-5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">{c.age}</span><span>{c.topics} chủ đề</span>
                </div>
                <h3 className="mt-3 text-lg font-bold">{c.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{c.desc}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs font-medium text-brand-700">Online · kèm 1-1</span>
                  <Link href="/learn" className="text-sm font-semibold text-brand-600 group-hover:underline">Xem chi tiết →</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* WHY */}
      <section className="bg-brand-50/60 py-16">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="text-center text-3xl font-extrabold">Vì sao chọn Minh Trí Academy?</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {reasons.map((r) => (
              <div key={r.t} className="card p-6">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand-100 text-2xl">{r.i}</div>
                <h3 className="mt-4 font-bold">{r.t}</h3>
                <p className="mt-1 text-sm text-slate-600">{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TEAM */}
      <section className="mx-auto max-w-7xl px-4 py-16">
        <h2 className="text-3xl font-extrabold">Đội ngũ giảng viên</h2>
        <p className="mt-2 text-xs text-slate-400">Thông tin mẫu — thay bằng hồ sơ thật.</p>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {teachers.map((t) => (
            <div key={t.name} className="card flex items-center gap-4 p-5">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-sun-400/30 text-3xl">{t.emoji}</div>
              <div><div className="font-bold">{t.name}</div><div className="text-sm text-slate-600">{t.role}</div></div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="bang-gia" className="scroll-mt-20 bg-slate-50 py-16">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="text-3xl font-extrabold">Bảng giá khóa học</h2>
          <p className="mt-2 text-xs text-slate-400">Mức giá minh họa — cập nhật theo chính sách thật. Mỗi khóa kích hoạt bằng Activation Code.</p>
          <div className="mt-8 overflow-x-auto">
            <table className="card w-full min-w-[560px] text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                <tr><th className="p-4">Khóa học</th><th className="p-4">Độ tuổi</th><th className="p-4">Số chủ đề</th><th className="p-4 text-right">Học phí</th></tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.slug} className="border-t border-slate-100">
                    <td className="p-4 font-semibold">{c.icon} {c.title}</td><td className="p-4">{c.age}</td><td className="p-4">{c.topics}</td>
                    <td className="p-4 text-right font-bold text-brand-700">{vnd(c.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS + NEWS */}
      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-extrabold">Cảm nhận</h2>
          <div className="mt-6 space-y-4">
            {testimonials.map((t) => (
              <blockquote key={t.quote} className="card border-l-4 border-l-brand-500 p-5">
                <p className="text-slate-700">“{t.quote}”</p><footer className="mt-2 text-xs text-slate-400">— {t.who}</footer>
              </blockquote>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-extrabold">Tin tức & Bài viết</h2>
          <div className="mt-6 space-y-4">
            {news.map((n) => (
              <a key={n.title} href="#" className="card block p-5 transition hover:border-brand-300">
                <div className="flex items-center gap-2 text-xs"><span className="rounded-full bg-brand-100 px-2 py-0.5 font-semibold text-brand-700">{n.tag}</span><span className="text-slate-400">{n.date}</span></div>
                <div className="mt-2 font-semibold">{n.title}</div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* CTA + LEAD */}
      <section id="tu-van" className="scroll-mt-20 bg-gradient-to-br from-brand-600 to-brand-800 py-16">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 lg:grid-cols-2">
          <div className="text-white">
            <h2 className="text-3xl font-extrabold">Nhận lộ trình học miễn phí cho con bạn</h2>
            <ul className="mt-4 space-y-2 text-brand-50">
              <li>✔ Test năng lực đầu vào miễn phí</li><li>✔ Tư vấn lộ trình theo độ tuổi & mục tiêu</li><li>✔ Tặng tài liệu Scratch/Python cơ bản</li>
            </ul>
          </div>
          <LeadForm />
        </div>
      </section>
      <Footer />
    </main>
  );
}
