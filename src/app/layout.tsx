import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A5 Design LINE OA Chatbot",
  description: "แชทบอท LINE OA และ dashboard ข้อมูลลูกค้า/market data ของ A5 Design by Asset Five",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
