// Minimal signed-cookie session for the internal dashboard. Uses Web Crypto so
// the same helpers work in middleware (edge) and in route handlers (node).

export const SESSION_COOKIE = "a5_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

export async function createSessionToken(username: string): Promise<string> {
  const payload = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS })),
  );
  return `${payload}.${await sign(payload, getSecret())}`;
}

async function decodeVerifiedPayload(token: string | undefined): Promise<{ u?: string; exp?: number } | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = await sign(payload, getSecret());
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json) as { u?: string; exp?: number };
    return typeof parsed.exp === "number" && parsed.exp > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  return (await decodeVerifiedPayload(token)) !== null;
}

// Who is behind a valid session — used to attribute audit-log entries for
// dashboard edits/deletes/merges to the account that made them.
export async function getSessionUsername(token: string | undefined): Promise<string | null> {
  const payload = await decodeVerifiedPayload(token);
  return payload?.u ?? null;
}
