import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function secret() {
  const value = process.env.SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production" || process.env.K_SERVICE)
    throw new Error("Configura SESSION_SECRET de al menos 32 caracteres.");
  const dir = path.resolve(
    /* turbopackIgnore: true */ process.env.MANABIT_DATA_DIR || ".data",
  );
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "local-session.key");
  if (!existsSync(file))
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  return readFileSync(file, "utf8");
}
export function sign(value: string) {
  const text = Buffer.from(value).toString("base64url");
  return `${text}.${createHmac("sha256", secret()).update(text).digest("base64url")}`;
}
export function verify(value?: string) {
  if (!value) return null;
  const [text, signature] = value.split(".");
  if (
    !text ||
    !signature ||
    !safeEqual(
      createHmac("sha256", secret()).update(text).digest("base64url"),
      signature,
    )
  )
    return null;
  return Buffer.from(text, "base64url").toString("utf8");
}
export function localAdmin(req: NextRequest) {
  return (
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(req.url).hostname)
  );
}
export function owner(req: NextRequest) {
  if (localAdmin(req)) return true;
  const value = verify(req.cookies.get("manabit_owner")?.value);
  return (
    !!value && value.startsWith("owner:") && Number(value.slice(6)) > Date.now()
  );
}
export function contactIdentity(req: NextRequest) {
  const value = verify(req.cookies.get("manabit_contact")?.value);
  return value?.startsWith("web:") ? value : null;
}
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (process.env.NODE_ENV !== "production" && localAdmin(req)) {
    const url = new URL(req.url);
    if (
      [`http://localhost:${url.port}`, `http://127.0.0.1:${url.port}`].includes(
        origin,
      )
    )
      return true;
  }
  const allowed = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : new URL(req.url).origin;
  return origin === allowed;
}
export function toolAuthorized(
  req: NextRequest,
  audience: "customer" | "owner",
) {
  const key =
    audience === "owner"
      ? process.env.MANABIT_OWNER_TOOLS_TOKEN
      : process.env.MANABIT_TOOLS_TOKEN;
  return (
    !!key &&
    key.length >= 32 &&
    safeEqual(req.headers.get("authorization") || "", `Bearer ${key}`)
  );
}
