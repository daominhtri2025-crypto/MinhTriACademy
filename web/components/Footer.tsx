export function Footer() {
  return (
    <footer className="mt-24 bg-slate-900 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="text-lg font-extrabold text-white">Minh Trí <span className="text-sun-400">Academy</span></div>
          <p className="mt-2 max-w-md text-sm">Trung tâm đào tạo lập trình cho trẻ em, học sinh và học viên mọi lứa tuổi.</p>
        </div>
        <div className="text-sm">
          <div className="mb-2 font-semibold text-white">Khám phá</div>
          <ul className="space-y-1"><li>Khóa học</li><li>Bảng giá</li><li>Tin tức</li></ul>
        </div>
        <div className="text-sm">
          <div className="mb-2 font-semibold text-white">Liên hệ</div>
          <ul className="space-y-1"><li>Hotline/Zalo: [cập nhật]</li><li>Đà Nẵng</li></ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-slate-500">© 2026 Minh Trí Academy · Prototype</div>
    </footer>
  );
}
