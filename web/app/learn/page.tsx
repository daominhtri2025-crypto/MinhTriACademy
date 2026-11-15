"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Accordion } from "@/components/Accordion";
import { quiz, syllabus, type LessonItem } from "@/lib/data";

const TYPE_META = {
  video: { icon: "▶", label: "Video" },
  reading: { icon: "📖", label: "Đọc" },
  quiz: { icon: "❓", label: "Trắc nghiệm" },
  coding: { icon: "💻", label: "Bài tập code" },
} as const;

const BADGES = [
  { id: "starter", icon: "🌱", name: "Khởi động", need: 1 },
  { id: "five", icon: "🔥", name: "5 bài liên tiếp", need: 5 },
  { id: "ten", icon: "🏅", name: "Chăm chỉ", need: 8 },
];

export default function LearnPage() {
  const all = useMemo(() => syllabus.flatMap((c) => c.lessons), []);
  const [done, setDone] = useState<Set<string>>(() => new Set(all.filter((l) => l.done).map((l) => l.id)));
  const [currentId, setCurrentId] = useState("l5");
  const [open, setOpen] = useState<Record<string, boolean>>({ c1: false, c2: true, c3: false });
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const current = all.find((l) => l.id === currentId)!;
  const pct = Math.round((done.size / all.length) * 100);
  const exp = done.size * 10;

  function complete(l: LessonItem, bonus = 0) {
    if (done.has(l.id)) return;
    const next = new Set(done).add(l.id);
    setDone(next);
    const newly = BADGES.filter((b) => next.size >= b.need && done.size < b.need);
    setToast(`+${10 + bonus} EXP${newly.length ? ` · Huy hiệu mới: ${newly.map((b) => b.icon + " " + b.name).join(", ")}` : ""}`);
    setTimeout(() => setToast(null), 3500);
  }

  const Sidebar = (
    <aside className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="text-xs font-semibold uppercase text-brand-700">Khóa học</div>
        <div className="font-bold">🐍 Python Từ Con Số 0</div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>Tiến độ</span><span className="font-semibold text-brand-700">{pct}%</span></div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto">
        {syllabus.map((c) => {
          const cd = c.lessons.filter((l) => done.has(l.id)).length;
          return (
            <div key={c.id} className="border-b border-slate-100">
              <button onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))} aria-expanded={!!open[c.id]}
                className="flex w-full items-center justify-between bg-slate-50 px-4 py-3 text-left text-sm font-semibold hover:bg-slate-100">
                <span>{c.title}<span className="ml-2 text-xs font-normal text-slate-400">{cd}/{c.lessons.length}</span></span>
                <span className={`transition-transform ${open[c.id] ? "rotate-180" : ""}`}>⌄</span>
              </button>
              {open[c.id] && (
                <ul>
                  {c.lessons.map((l) => {
                    const active = l.id === currentId;
                    return (
                      <li key={l.id}>
                        <button onClick={() => { setCurrentId(l.id); setSidebar(false); }}
                          className={`flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm transition ${active ? "bg-brand-50 text-brand-800" : "hover:bg-slate-50"}`}>
                          <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${done.has(l.id) ? "bg-brand-500 text-white" : "border border-slate-300 text-slate-400"}`}>
                            {done.has(l.id) ? "✓" : ""}
                          </span>
                          <span className="flex-1"><span className="block leading-snug">{l.title}</span>
                            <span className="text-xs text-slate-400">{TYPE_META[l.type].icon} {TYPE_META[l.type].label} · {l.minutes} phút</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Gamification bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm">
        <button className="btn-ghost !px-3 !py-1.5 lg:hidden" onClick={() => setSidebar((v) => !v)}>☰ Bài học</button>
        <Link href="/" className="text-slate-500 hover:text-brand-700">← Trang chủ</Link>
        <div className="ml-auto flex items-center gap-4">
          <span className="rounded-full bg-sun-400/25 px-3 py-1 font-bold text-amber-800">⭐ {exp} EXP</span>
          <span className="hidden gap-1 sm:flex" aria-label="Huy hiệu">
            {BADGES.map((b) => (
              <span key={b.id} title={`${b.name} (${b.need} bài)`} className={`grid h-8 w-8 place-items-center rounded-full text-base ${done.size >= b.need ? "bg-brand-100" : "bg-slate-100 opacity-40 grayscale"}`}>{b.icon}</span>
            ))}
          </span>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="hidden w-80 shrink-0 lg:block">{Sidebar}</div>
        {sidebar && (<div className="absolute inset-y-0 left-0 z-30 w-80 shadow-2xl lg:hidden">{Sidebar}</div>)}

        <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50">
          <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
            <div>
              <div className="text-xs font-semibold uppercase text-brand-700">{TYPE_META[current.type].icon} {TYPE_META[current.type].label}</div>
              <h1 className="mt-1 text-2xl font-extrabold">{current.title}</h1>
            </div>

            {current.type === "video" && <VideoBlock />}
            {current.type === "reading" && <ReadingBlock />}
            {current.type === "quiz" && <QuizBlock key={current.id} onPass={() => complete(current)} />}
            {current.type === "coding" && <CodingBlock />}

            {current.type !== "quiz" && (
              <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                <span className="text-sm text-slate-500">{done.has(current.id) ? "✓ Đã hoàn thành" : "Chưa hoàn thành"}</span>
                <button className="btn-primary" disabled={done.has(current.id)} onClick={() => complete(current)}>Đánh dấu hoàn thành</button>
              </div>
            )}
          </div>
        </main>
      </div>

      {toast && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-pop rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">🎉 {toast}</div>}
    </div>
  );
}

function VideoBlock() {
  return (
    <div className="card overflow-hidden">
      <div className="relative grid aspect-video place-items-center bg-gradient-to-br from-slate-800 to-slate-950">
        <button className="grid h-20 w-20 place-items-center rounded-full bg-white/90 text-3xl text-brand-700 shadow-lg transition hover:scale-105" aria-label="Phát video">▶</button>
        <span className="absolute bottom-3 left-4 text-xs text-slate-300">Prototype: thay bằng player (Cloudflare Stream/Mux, signed URL TTL ngắn)</span>
      </div>
      <div className="p-5 text-sm leading-relaxed text-slate-700">
        <h3 className="font-bold">Tóm tắt bài giảng</h3>
        <p className="mt-1">Vòng lặp <code className="rounded bg-slate-100 px-1">for</code> duyệt qua một dãy giá trị. Hàm <code className="rounded bg-slate-100 px-1">range(a, b)</code> sinh dãy từ <em>a</em> đến <em>b-1</em>.</p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-slate-100"><code>{`for i in range(1, 4):\n    print("Lần", i)`}</code></pre>
      </div>
    </div>
  );
}

function ReadingBlock() {
  return (
    <article className="card space-y-3 p-6 text-sm leading-relaxed text-slate-700">
      <p>Biến là “chiếc hộp có nhãn” dùng để lưu dữ liệu. Python tự suy ra kiểu của biến khi gán giá trị.</p>
      <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-slate-100"><code>{`tuoi = 10        # int\nten = "Mai"      # str\ncao = 1.35       # float`}</code></pre>
      <div className="rounded-xl bg-amber-50 p-4 text-amber-900">💡 Đặt tên biến có nghĩa: <code>tong_diem</code> tốt hơn <code>x</code>.</div>
    </article>
  );
}

function QuizBlock({ onPass }: { onPass: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const ok = picked === quiz.correct;
  return (
    <div className="card space-y-4 p-6">
      <p className="font-semibold">{quiz.question}</p>
      <div className="space-y-2">
        {quiz.options.map((o, i) => {
          const state = submitted ? (i === quiz.correct ? "border-brand-500 bg-brand-50" : i === picked ? "border-red-400 bg-red-50" : "border-slate-200") : picked === i ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50";
          return (
            <button key={o} disabled={submitted} onClick={() => setPicked(i)} className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${state}`}>
              <span className="grid h-6 w-6 place-items-center rounded-full border text-xs font-bold">{String.fromCharCode(65 + i)}</span>{o}
            </button>
          );
        })}
      </div>
      {!submitted ? (
        <button className="btn-primary" disabled={picked === null} onClick={() => { setSubmitted(true); if (ok) onPass(); }}>Nộp bài</button>
      ) : (
        <div className={`rounded-xl p-4 text-sm ${ok ? "bg-brand-50 text-brand-900" : "bg-red-50 text-red-900"}`}>
          <b>{ok ? "Chính xác! +10 EXP" : "Chưa đúng."}</b> {quiz.explanation}
          {!ok && <button className="ml-3 font-semibold underline" onClick={() => { setSubmitted(false); setPicked(null); }}>Thử lại</button>}
        </div>
      )}
      <p className="text-xs text-slate-400">Chấm tự động ở server (submissions.state = auto_graded); client chỉ hiển thị kết quả.</p>
    </div>
  );
}

function CodingBlock() {
  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-6 text-sm leading-relaxed text-slate-700">
        <h3 className="font-bold">Đề bài</h3>
        <p>Nhập số nguyên <b>N</b>. In ra tổng các số chẵn từ 1 đến N.</p>
        <table className="w-full max-w-sm text-left text-xs">
          <thead className="text-slate-400"><tr><th className="py-1">Input</th><th>Output</th></tr></thead>
          <tbody className="font-mono"><tr><td>10</td><td>30</td></tr><tr><td>7</td><td>12</td></tr></tbody>
        </table>
        <Link href="/ide" className="btn-primary !inline-flex">Mở trong Online IDE →</Link>
      </div>
      <Accordion icon="💡" title="Gợi ý (Hint)" tone="amber">
        Dùng <code>range(2, n + 1, 2)</code> để duyệt trực tiếp các số chẵn, hoặc kiểm tra <code>i % 2 == 0</code> trong vòng lặp thường.
      </Accordion>
      <Accordion icon="✅" title="Lời giải mẫu (Solution)" tone="green">
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-slate-100"><code>{`n = int(input())\nprint(sum(range(2, n + 1, 2)))`}</code></pre>
        <p className="mt-2 text-slate-500">Độ phức tạp O(N). Có thể tính O(1) bằng công thức m·(m+1) với m = N // 2.</p>
      </Accordion>
    </div>
  );
}
