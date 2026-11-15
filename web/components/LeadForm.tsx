"use client";
import { useState } from "react";

const kinds = [
  { v: "consult", label: "Tư vấn lộ trình" },
  { v: "placement_test", label: "Test năng lực miễn phí" },
  { v: "free_material", label: "Nhận tài liệu Scratch/Python" },
];

export function LeadForm() {
  const [kind, setKind] = useState("consult");
  const [sent, setSent] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Prototype: thay bằng POST /v1/leads (bảng `leads`, có cờ consent).
    setSent(true);
  }

  if (sent) {
    return (
      <div className="card animate-pop p-8 text-center">
        <div className="text-4xl">🎉</div>
        <h3 className="mt-2 text-xl font-bold">Đã nhận đăng ký!</h3>
        <p className="mt-1 text-slate-600">Minh Trí Academy sẽ liên hệ trong vòng 24 giờ làm việc.</p>
      </div>
    );
  }

  const input = "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200";
  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-6 text-left">
      <div className="grid gap-2 sm:grid-cols-3">
        {kinds.map((k) => (
          <button key={k.v} type="button" onClick={() => setKind(k.v)}
            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${kind === k.v ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input required placeholder="Họ tên phụ huynh / học viên" className={input} />
        <input required type="tel" placeholder="Số điện thoại" className={input} />
        <input type="email" placeholder="Email (không bắt buộc)" className={input} />
        <select className={input} defaultValue="">
          <option value="" disabled>Độ tuổi của học viên</option>
          <option>6–9 tuổi</option><option>10–12 tuổi</option><option>13–15 tuổi</option><option>16 tuổi trở lên</option>
        </select>
      </div>
      <label className="flex items-start gap-2 text-xs text-slate-500">
        <input required type="checkbox" className="mt-0.5" />
        Tôi đồng ý để Minh Trí Academy liên hệ và xử lý dữ liệu cá nhân phục vụ tư vấn.
      </label>
      <button className="btn-primary w-full">Gửi đăng ký</button>
    </form>
  );
}
