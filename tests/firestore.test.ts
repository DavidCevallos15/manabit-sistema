import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bookAppointment, BookingError } from "../src/core/booking.ts";
import { initialProfile } from "../src/server/profile.ts";
import { createFirestoreStore, docId } from "../src/server/firestore-store.ts";

// Contrato del almacén Firestore. Requiere el emulador:
//   gcloud emulators firestore start --host-port=127.0.0.1:8085
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm test
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const skip = emulator ? false : "sin FIRESTORE_EMULATOR_HOST";
const fresh = () =>
  createFirestoreStore({ projectId: `demo-manabit-${randomUUID().slice(0, 8)}`, cacheSeconds: 60 });
const business = initialProfile.business;
const now = new Date("2029-01-01T00:00:00Z");
const input = (startAt: string, key = randomUUID()) => ({
  customerRef: "test:firestore",
  serviceId: "diagnostico",
  professionalId: "david",
  startAt,
  channel: "web" as const,
  accepted: true,
  idempotencyKey: key,
});

test("docId produce IDs válidos para Firestore", () => {
  assert.equal(docId("job:meta/123"), "job%3Ameta%2F123");
  assert.equal(docId("."), "%2E");
  assert.equal(docId(".."), "%2E%2E");
  assert.ok(!docId("__x__").startsWith("__"));
});

test("Firestore: dos reservas simultáneas al mismo espacio, solo una se guarda", { skip }, async () => {
  const s = fresh();
  const at = "2030-01-07T10:00:00-05:00";
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => bookAppointment(business, input(at), s.bookings, now)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results)
    if (r.status === "rejected") {
      assert.ok(r.reason instanceof BookingError);
      assert.equal(r.reason.code, "SLOT_TAKEN");
    }
  assert.equal((await s.bookings.list("manabit")).length, 1);
});

test("Firestore: idempotencia y cancelación liberan o reutilizan correctamente", { skip }, async () => {
  const s = fresh();
  const at = "2030-01-08T11:00:00-05:00";
  const key = randomUUID();
  const a = await bookAppointment(business, input(at, key), s.bookings, now);
  const b = await bookAppointment(business, input(at, key), s.bookings, now);
  assert.equal(a.id, b.id);
  await assert.rejects(
    bookAppointment(business, { ...input("2030-01-08T12:00:00-05:00"), idempotencyKey: key }, s.bookings, now),
    (e: unknown) => e instanceof BookingError && e.code === "IDEMPOTENCY_CONFLICT",
  );
  await s.bookings.cancel("manabit", a.id);
  assert.equal((await s.bookings.list("manabit"))[0]?.status, "cancelled");
  const again = await bookAppointment(business, input(at), s.bookings, now);
  assert.notEqual(again.id, a.id);
  await assert.rejects(s.bookings.cancel("manabit", "no-existe"), BookingError);
});

test("Firestore: registros, claim, caché invalidada y orden de creación", { skip }, async () => {
  const s = fresh();
  assert.equal(await s.claimRecord("job", "meta/1", { n: 1 }, "manabit"), true);
  assert.equal(await s.claimRecord("job", "meta/1", { n: 2 }, "manabit"), false);
  assert.deepEqual(await s.getRecord("job", "meta/1", "manabit"), { n: 1 });
  assert.equal((await s.listRecords("task", "manabit")).length, 0); // queda en caché
  await s.putRecord("task", "a", { v: 1 }, "manabit");
  await new Promise((r) => setTimeout(r, 5));
  await s.putRecord("task", "b", { v: 2 }, "manabit");
  await s.putRecord("task", "a", { v: 3 }, "manabit"); // actualizar no cambia el orden
  assert.deepEqual(await s.listRecords("task", "manabit"), [{ v: 2 }, { v: 3 }]);
  assert.equal(await s.getRecord("task", "zzz", "manabit"), undefined);
});

test("Firestore: leases exclusivos y límites de uso", { skip }, async () => {
  const s = fresh();
  assert.equal(await s.acquireLease("job:1", "t1"), true);
  assert.equal(await s.acquireLease("job:1", "t2"), false);
  await s.releaseLease("job:1", "t2");
  assert.equal(await s.acquireLease("job:1", "t3"), false);
  await s.releaseLease("job:1", "t1");
  assert.equal(await s.acquireLease("job:1", "t3"), true);
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await s.consumeLimit("login:1.2.3.4", 2, 60));
  assert.deepEqual(results, [true, true, false]);
});
