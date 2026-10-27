// Prueba HTTP del build real, con claves y datos efímeros; no llama servicios externos.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";

const socket = net.createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
const password = randomBytes(32).toString("hex");
const customerToken = randomBytes(32).toString("hex");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_URL: base,
      MANABIT_DATA_DIR: mkdtempSync(path.join(tmpdir(), "manabit-prod-test-")),
      DATABASE_URL: "",
      K_SERVICE: "",
      SESSION_SECRET: randomBytes(32).toString("hex"),
      ADMIN_PASSWORD: password,
      MANABIT_TOOLS_TOKEN: customerToken,
      MANABIT_OWNER_TOOLS_TOKEN: randomBytes(32).toString("hex"),
      GOOGLE_AGENT_ENGINE_ID: "",
      GOOGLE_OWNER_AGENT_ENGINE_ID: "",
      SOCIAL_AUTOMATION_ENABLED: "false",
    },
  },
);
async function post(route, body, headers = {}) {
  return fetch(base + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, ...headers },
    body: JSON.stringify(body),
  });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null)
      throw new Error("El servidor de prueba terminó antes de iniciar.");
    try {
      ready = (await fetch(base + "/api/health")).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "El build debe iniciar");
  assert.equal((await fetch(base + "/api/admin/state")).status, 401);
  assert.equal(
    (await post("/api/auth/login", { password: "incorrecta" })).status,
    401,
  );
  const login = await post("/api/auth/login", { password });
  assert.equal(login.status, 200);
  const ownerCookie = login.headers.get("set-cookie").split(";")[0];
  const state = await fetch(base + "/api/admin/state", {
    headers: { Cookie: ownerCookie },
  });
  assert.equal(state.status, 200);
  assert.equal((await state.json()).profile.business.name, "Manabit");
  assert.equal(
    (
      await post(
        "/api/admin/cancel",
        { id: "unused" },
        { Cookie: ownerCookie, Origin: "https://foreign.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        "/api/tools/owner",
        { action: "metrics" },
        { Authorization: `Bearer ${customerToken}` },
      )
    ).status,
    401,
  );
  const session = await post("/api/public/session", {});
  assert.equal(session.status, 200);
  const contactCookie = session.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await fetch(base + "/api/admin/state", {
        headers: { Cookie: contactCookie },
      })
    ).status,
    401,
  );
  const result = await post(
    "/api/public/message",
    { text: "¿Qué incluye Tongabit?", event: "production-check-event" },
    { Cookie: contactCookie },
  );
  assert.equal(result.status, 200);
  assert.ok(
    (await result.json()).conversation.messages
      .at(-1)
      .text.includes("Tongabit"),
  );
  console.log(
    "Producción: login, panel privado, origen, permisos de herramientas y chat público verificados.",
  );
} finally {
  child.kill();
}
