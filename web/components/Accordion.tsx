"use client";
import { useId, useState, type ReactNode } from "react";

/**
 * Accordion Gợi ý / Lời giải: mặc định thu gọn; click 1 → trượt mở, click 2 → thu lại.
 * Dùng kỹ thuật grid-template-rows 0fr → 1fr để animate chiều cao "auto" mượt, không cần JS đo.
 * LƯU Ý BẢO MẬT: đây chỉ là lớp hiển thị. Lời giải thật phải lấy qua endpoint có kiểm soát (ARCHITECTURE §2.4).
 */
export function Accordion({ icon, title, tone = "amber", children }: {
  icon: string; title: string; tone?: "amber" | "green"; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
    green: "border-brand-200 bg-brand-50 text-brand-900 hover:bg-brand-100",
  } as const;
  return (
    <div className={`overflow-hidden rounded-xl border ${tones[tone].split(" ").slice(0, 2).join(" ")}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold transition ${tones[tone]}`}
      >
        <span className="flex items-center gap-2"><span aria-hidden>{icon}</span>{title}</span>
        <svg className={`h-4 w-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      <div id={id} role="region" className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="border-t border-black/5 bg-white/70 px-4 py-3 text-sm leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
