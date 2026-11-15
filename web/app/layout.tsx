import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Minh Trí Academy — Học lập trình cho trẻ em & mọi lứa tuổi",
  description: "Scratch, Python, Java, C++ với lộ trình cá nhân hóa, LMS và Online IDE.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <Navbar />
        {children}
      </body>
    </html>
  );
}
