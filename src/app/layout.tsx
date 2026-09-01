import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A5 Design Dashboard",
  description: "ข้อมูลลูกค้าและ market data จาก LINE OA ของ A5 Design by Asset Five",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
