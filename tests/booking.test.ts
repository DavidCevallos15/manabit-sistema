import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookAppointment,
  BookingError,
  InMemoryBookingRepository,
} from "../src/core/booking.ts";
import { clinic, barber } from "../src/core/presets.ts";
import type { BookingInput } from "../src/core/types.ts";

const now = new Date("2030-01-01T00:00:00Z");
const input: BookingInput = {
  serviceId: "consulta",
  professionalId: "profesional-1",
  customerRef: "paciente-demo",
  startAt: "2030-01-07T10:00:00-05:00",
  channel: "web",
  accepted: true,
  idempotencyKey: "operacion-1",
};
const error = (code: string) => (e: unknown) =>
  e instanceof BookingError && e.code === code;

test("confirma y guarda UTC respetando la duración y preparación", async () => {
  const booking = await bookAppointment(
    clinic,
    input,
    new InMemoryBookingRepository(),
    now,
  );
  assert.equal(booking.status, "confirmed");
  assert.equal(booking.startAt, "2030-01-07T15:00:00.000Z");
  assert.equal(booking.endAt, "2030-01-07T15:30:00.000Z");
  assert.equal(booking.blockedEndAt, "2030-01-07T15:40:00.000Z");
});

test("los tres canales usan la misma agenda y rechazan un solapamiento", async () => {
  const repo = new InMemoryBookingRepository();
  await bookAppointment(clinic, input, repo, now);
  for (const channel of ["whatsapp", "messenger"] as const) {
    await assert.rejects(
      bookAppointment(
        clinic,
        { ...input, channel, idempotencyKey: channel },
        repo,
        now,
      ),
      error("SLOT_TAKEN"),
    );
  }
});

test("dos solicitudes simultáneas para el mismo horario solo crean una cita", async () => {
  const repo = new InMemoryBookingRepository();
  const result = await Promise.allSettled([
    bookAppointment(clinic, input, repo, now),
    bookAppointment(
      clinic,
      { ...input, idempotencyKey: "operacion-2" },
      repo,
      now,
    ),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await repo.list(clinic.id)).length, 1);
});

test("la misma operación simultánea es idempotente", async () => {
  const repo = new InMemoryBookingRepository();
  const [a, b] = await Promise.all([
    bookAppointment(clinic, input, repo, now),
    bookAppointment(clinic, input, repo, now),
  ]);
  assert.equal(a.id, b.id);
  assert.equal((await repo.list(clinic.id)).length, 1);
});

test("reentregar el mismo evento después de la cita devuelve la reserva original", async () => {
  const repo = new InMemoryBookingRepository();
  const a = await bookAppointment(clinic, input, repo, now);
  const b = await bookAppointment(
    clinic,
    input,
    repo,
    new Date("2031-01-01T00:00:00Z"),
  );
  assert.equal(a.id, b.id);
});

test("reutilizar una clave con otros datos se rechaza", async () => {
  const repo = new InMemoryBookingRepository();
  await bookAppointment(clinic, input, repo, now);
  await assert.rejects(
    bookAppointment(
      clinic,
      { ...input, startAt: "2030-01-07T11:00:00-05:00" },
      repo,
      now,
    ),
    error("IDEMPOTENCY_CONFLICT"),
  );
});

test("el tiempo de preparación también impide reservas y permite el límite contiguo", async () => {
  const repo = new InMemoryBookingRepository();
  await bookAppointment(clinic, input, repo, now);
  await assert.rejects(
    bookAppointment(
      clinic,
      {
        ...input,
        startAt: "2030-01-07T10:30:00-05:00",
        idempotencyKey: "otra",
      },
      repo,
      now,
    ),
    error("SLOT_TAKEN"),
  );
  const next = await bookAppointment(
    clinic,
    {
      ...input,
      startAt: "2030-01-07T10:40:00-05:00",
      idempotencyKey: "contigua",
    },
    repo,
    now,
  );
  assert.equal(next.status, "confirmed");
});

test("cambiar de consultorio a barbería usa el mismo motor con otra duración", async () => {
  const repo = new InMemoryBookingRepository();
  const a = await bookAppointment(clinic, input, repo, now);
  const b = await bookAppointment(
    barber,
    { ...input, serviceId: "corte" },
    repo,
    now,
  );
  assert.notEqual(a.tenantId, b.tenantId);
  assert.equal(b.endAt, "2030-01-07T15:45:00.000Z");
  assert.equal((await repo.list(clinic.id)).length, 1);
  assert.equal((await repo.list(barber.id)).length, 1);
});

test("otro profesional puede atender en paralelo", async () => {
  const config = {
    ...clinic,
    professionals: [
      ...clinic.professionals,
      { ...clinic.professionals[0]!, id: "profesional-2" },
    ],
  };
  const repo = new InMemoryBookingRepository();
  await bookAppointment(config, input, repo, now);
  await bookAppointment(
    config,
    { ...input, professionalId: "profesional-2", idempotencyKey: "otra" },
    repo,
    now,
  );
  assert.equal((await repo.list(config.id)).length, 2);
});

test("un servicio/profesional ajeno al negocio no se reserva", async () => {
  await assert.rejects(
    bookAppointment(
      clinic,
      { ...input, serviceId: "corte" },
      new InMemoryBookingRepository(),
      now,
    ),
    error("INVALID_SERVICE"),
  );
  await assert.rejects(
    bookAppointment(
      clinic,
      { ...input, professionalId: "externo" },
      new InMemoryBookingRepository(),
      now,
    ),
    error("INVALID_SERVICE"),
  );
});

test("descansos, días bloqueados y preparación fuera de horario se rechazan", async () => {
  for (const startAt of [
    "2030-01-07T13:00:00-05:00",
    "2030-01-07T17:30:00-05:00",
  ]) {
    await assert.rejects(
      bookAppointment(
        clinic,
        { ...input, startAt },
        new InMemoryBookingRepository(),
        now,
      ),
      error("OUTSIDE_HOURS"),
    );
  }
  await assert.rejects(
    bookAppointment(
      { ...clinic, closedDates: ["2030-01-07"] },
      input,
      new InMemoryBookingRepository(),
      now,
    ),
    error("OUTSIDE_HOURS"),
  );
});

test("no confirma sin aceptación de la persona", async () => {
  await assert.rejects(
    bookAppointment(
      clinic,
      { ...input, accepted: false },
      new InMemoryBookingRepository(),
      now,
    ),
    error("ACCEPTANCE_REQUIRED"),
  );
});

test("la política de recepción deja la cita pendiente de confirmación", async () => {
  const booking = await bookAppointment(
    { ...clinic, confirmation: "reception" },
    input,
    new InMemoryBookingRepository(),
    now,
  );
  assert.equal(booking.status, "pending_confirmation");
});

test("no acepta horas pasadas, ambiguas o fuera del intervalo", async () => {
  await assert.rejects(
    bookAppointment(
      clinic,
      input,
      new InMemoryBookingRepository(),
      new Date("2031-01-01T00:00:00Z"),
    ),
    error("PAST_TIME"),
  );
  for (const startAt of [
    "2030-01-07T10:00:00",
    "2030-01-07T10:01:00-05:00",
    "2030-01-07T10:00:30-05:00",
  ]) {
    await assert.rejects(
      bookAppointment(
        clinic,
        { ...input, startAt },
        new InMemoryBookingRepository(),
        now,
      ),
      error("INVALID_TIME"),
    );
  }
});

test("cancelar libera el horario y otro negocio no puede cancelar esa cita", async () => {
  const repo = new InMemoryBookingRepository();
  const booking = await bookAppointment(clinic, input, repo, now);
  await assert.rejects(repo.cancel(barber.id, booking.id), error("NOT_FOUND"));
  await repo.cancel(clinic.id, booking.id);
  const next = await bookAppointment(
    clinic,
    { ...input, idempotencyKey: "otra" },
    repo,
    now,
  );
  assert.equal(next.status, "confirmed");
});
