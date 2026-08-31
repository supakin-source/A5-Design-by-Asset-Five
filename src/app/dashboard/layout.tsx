import Link from "next/link";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <nav className="nav">
          <Link href="/dashboard">ภาพรวม</Link>
          <Link href="/dashboard/leads">รายชื่อลูกค้า</Link>
          <Link href="/dashboard/analytics">Market data</Link>
        </nav>
        <form action="/api/auth/logout" method="post">
          <button className="link-button" type="submit">
            ออกจากระบบ
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
