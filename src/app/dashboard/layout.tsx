import Link from "next/link";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <Link href="/dashboard" className="brandmark">
            A5 Design
          </Link>
          <nav className="nav">
            <Link href="/dashboard">ภาพรวม</Link>
            <Link href="/dashboard/leads">รายการงาน</Link>
            <Link href="/dashboard/analytics">Market Data</Link>
            <Link href="/dashboard/audit-log">ประวัติการแก้ไข</Link>
          </nav>
        </div>
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
