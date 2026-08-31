import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { username, password } = (await req.json()) as { username?: string; password?: string };

  const expectedUser = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedUser || !expectedPassword) {
    return NextResponse.json({ error: "dashboard credentials are not configured" }, { status: 500 });
  }

  if (username !== expectedUser || password !== expectedPassword) {
    return NextResponse.json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}
