const SESSION_COOKIE = "ms_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

type SessionPayload = {
  username: string;
  exp: number;
};

function toBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }

  return btoa(text).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }

  return null;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signToken(payload: SessionPayload, secret: string): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

async function verifyToken(token: string, secret: string): Promise<SessionPayload | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(fromBase64Url(signature)),
    new TextEncoder().encode(body),
  );

  if (!valid) {
    return null;
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as SessionPayload;
    if (!payload.username || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);

  let mismatch = leftBytes.length === rightBytes.length ? 0 : 1;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

function cookieAttributes(request: Request): string {
  const origin = request.headers.get("Origin") ?? "";
  if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
    return "Path=/; HttpOnly; SameSite=Lax; Max-Age=43200";
  }

  return "Path=/; HttpOnly; Secure; SameSite=None; Max-Age=43200";
}

export async function createSessionCookie(request: Request, username: string, secret: string): Promise<string> {
  const token = await signToken(
    {
      username,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    secret,
  );

  return `${SESSION_COOKIE}=${token}; ${cookieAttributes(request)}`;
}

export function clearSessionCookie(request: Request): string {
  const attributes = cookieAttributes(request).replace(/Max-Age=\d+/u, "Max-Age=0");
  return `${SESSION_COOKIE}=; ${attributes}`;
}

export async function getSession(request: Request, sessionSecret: string): Promise<{ authenticated: boolean; username: string | null }> {
  const token = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) {
    return { authenticated: false, username: null };
  }

  const payload = await verifyToken(token, sessionSecret);
  if (!payload) {
    return { authenticated: false, username: null };
  }

  return {
    authenticated: true,
    username: payload.username,
  };
}

export function isValidLogin(username: string, password: string, expectedUsername: string, expectedPassword: string): boolean {
  return constantTimeEqual(username.trim(), expectedUsername) && constantTimeEqual(password, expectedPassword);
}

export function getAllowedOrigins(appOrigin: string, extraAllowedOrigins: string | undefined): string[] {
  return [
    appOrigin,
    ...((extraAllowedOrigins ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)),
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
}

export function isAllowedAdminOrigin(request: Request, appOrigin: string, extraAllowedOrigins?: string): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return false;
  }

  return getAllowedOrigins(appOrigin, extraAllowedOrigins).includes(origin);
}
