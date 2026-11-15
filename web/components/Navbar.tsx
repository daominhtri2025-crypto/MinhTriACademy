"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Trang chủ" },
  { href: "/#khoa-hoc", label: "Khóa học" },
  { href: "/#bang-gia", label: "Bảng giá" },
  { href: "/learn", label: "Học thử (LMS)" },
  { href: "/ide", label: "Online IDE" },
];

export function Navbar() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-extrabold text-brand-700">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-lg text-white">M</span>
          <span>Minh Trí <span className="text-sun-500">Academy</span></span>
        </Link>
        <nav className="hidden gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-brand-50 hover:text-brand-700 ${path === l.href ? "text-brand-700" : "text-slate-600"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/learn" className="btn-ghost hidden sm:inline-flex">Đăng nhập</Link>
          <Link href="/#tu-van" className="btn-primary">Tư vấn miễn phí</Link>
        </div>
      </div>
    </header>
  );
}
