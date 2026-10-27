import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import { NextRequest } from "next/server.js";
import { bookAppointment } from "../src/core/booking.ts";
import {
  persistentBookings,
  profile,
  availableSlots,
} from "../src/server/bookings.ts";
import { database, getRecord } from "../src/server/db.ts";
import {
  ensureConversation,
  receiveMessage,
} from "../src/server/conversations.ts";
import { propose, confirmProposal } from "../src/server/proposals.ts";
import {
  extractMeta,
  verifyMetaSignature,
  channelStatus,
} from "../src/server/channels.ts";
import { owner, sign, verify, toolAuthorized } from "../src/server/auth.ts";

process.env.MANABIT_DATA_DIR = mkdtempSync(
  path.join(tmpdir(), "manabit-test-"),
);
process.env.SESSION_SECRET =
  "test-session-secret-at-least-thirty-two-characters";
delete process.env.DATABASE_URL;
delete process.env.GOOGLE_AGENT_ENGINE_ID;

test("perfil real de Manabit usa lunes a viernes 09–17 y diagnósticos de 15 minutos", async () => {
  const p = await profile();
  assert.equal(p.business.id, "manabit");
  assert.equal(p.business.services[0]?.durationMinutes, 15);
  assert.equal(p.business.hours.length, 5);
  assert.ok(
    p.business.hours.every((h) => h.from === "09:00" && h.to === "17:00"),
  );
});
test("SQLite persiste una reserva y rechaza dos solicitudes simultáneas para el mismo espacio", async () => {
  const p = await profile();
  const now = new Date("2029-01-01T00:00:00Z");
  const input = {
    customerRef: "test:owner",
    serviceId: "diagnostico",
    professionalId: "david",
    startAt: "2030-01-07T10:00:00-05:00",
    channel: "web" as const,
    accepted: true,
    idempotencyKey: randomUUID(),
  };
  const result = await Promise.allSettled([
    bookAppointment(p.business, input, persistentBookings, now),
    bookAppointment(
      p.business,
      { ...input, idempotencyKey: randomUUID() },
      persistentBookings,
      now,
    ),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const db = await database();
  const r = await db.query("SELECT payload FROM appointments WHERE tenant=$1", [
    "manabit",
  ]);
  assert.equal(r.rows.length, 1);
});
test("repetir el mensaje no duplica turnos ni respuesta; hablar con David pausa el asistente", async () => {
  const c = await ensureConversation(`test:${randomUUID()}`);
  const event = randomUUID();
  const a = await receiveMessage(c.id, "¿Qué planes ofrecen?", event);
  const b = await receiveMessage(c.id, "¿Qué planes ofrecen?", event);
  assert.equal(a.messages.length, b.messages.length);
  assert.ok(a.messages.at(-1)?.text.includes("Tongabit"));
  const human = await receiveMessage(
    c.id,
    "Quiero hablar con David",
    randomUUID(),
  );
  assert.equal(human.status, "human");
  const paused = await receiveMessage(c.id, "hola otra vez", randomUUID());
  assert.equal(paused.messages.at(-1)?.role, "customer");
});
test("solo el mensaje de aceptación del contacto de la propuesta permite reservar", async () => {
  const a = await ensureConversation(`test:${randomUUID()}`);
  const b = await ensureConversation(`test:${randomUUID()}`);
  let date = new Date(Date.now() + 7 * 86400_000);
  while ([0, 6].includes(date.getUTCDay()))
    date = new Date(date.getTime() + 86400_000);
  const dateText = date.toISOString().slice(0, 10);
  const slots = await availableSlots(dateText);
  assert.ok(slots.length);
  const proposal = await propose(a, {
    startAt: slots[0]!.startAt,
    mode: "videollamada",
  });
  assert.ok((await confirmProposal(b, proposal.code)).includes("no pertenece"));
  const text = await confirmProposal(a, proposal.code);
  assert.ok(text.includes("quedó registrado"));
  const bookings = await persistentBookings.list("manabit");
  const saved = bookings.find((item) => item.customerRef === a.contact);
  assert.ok(saved);
  assert.equal(
    (await getRecord<{ promotional: boolean }>("consent", saved.id))
      ?.promotional,
    false,
  );
});
test("firmas, sesión y herramientas rechazan identidades manipuladas", () => {
  const token = sign("owner:123");
  assert.equal(verify(token), "owner:123");
  assert.equal(verify(token + "x"), null);
  process.env.META_APP_SECRET = "meta-test-secret";
  const body = '{"object":"instagram"}';
  const signature =
    "sha256=" +
    createHmac("sha256", process.env.META_APP_SECRET)
      .update(body)
      .digest("hex");
  assert.equal(verifyMetaSignature(body, signature), true);
  assert.equal(verifyMetaSignature(body + " ", signature), false);
  assert.equal(
    owner(new NextRequest("https://example.com/api/admin/state")),
    false,
  );
  process.env.MANABIT_TOOLS_TOKEN = "customer-key-at-least-32-characters-long";
  process.env.MANABIT_OWNER_TOOLS_TOKEN =
    "owner-key-at-least-32-characters-long";
  const request = new NextRequest("https://example.com/api/tools/owner", {
    headers: { Authorization: "Bearer " + process.env.MANABIT_TOOLS_TOKEN },
  });
  assert.equal(toolAuthorized(request, "owner"), false);
});
test("el webhook ignora cuentas ajenas y los canales no se muestran como conectados por simulación", async () => {
  process.env.INSTAGRAM_ACCOUNT_ID = "ig-own";
  const events = extractMeta({
    object: "instagram",
    entry: [
      {
        id: "ig-other",
        messaging: [
          { sender: { id: "person" }, message: { mid: "x", text: "hi" } },
        ],
      },
    ],
  });
  assert.equal(events.length, 0);
  const status = await channelStatus();
  assert.equal(status.find((s) => s.id === "web")?.status, "active");
  assert.equal(
    status.find((s) => s.id === "instagram")?.status,
    "disconnected",
  );
});
