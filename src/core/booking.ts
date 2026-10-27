import { createHash, randomUUID } from "node:crypto";
import type {
  Booking,
  BookingInput,
  BookingRepository,
  BusinessConfig,
  Day,
  Hours,
} from "./types.ts";

export class BookingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BookingError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new BookingError(code, message);
}

function localTime(value: Date, timeZone: string) {
  const fields = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${fields.year}-${fields.month}-${fields.day}`,
    day: fields.weekday as Day,
    minute: Number(fields.hour) * 60 + Number(fields.minute),
  };
}

function minute(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    return fail("BAD_CONFIG", "Horario de atención inválido.");
  const [h, m] = value.split(":").map(Number);
  return h! * 60 + m!;
}

function fits(hours: readonly Hours[], day: Day, from: number, to: number) {
  return hours.some(
    (h) => h.day === day && from >= minute(h.from) && to <= minute(h.to),
  );
}

/** Recibe el negocio resuelto por el servidor, nunca un tenant elegido sin autorización. */
export async function bookAppointment(
  config: BusinessConfig,
  input: BookingInput,
  repo: BookingRepository,
  now = new Date(),
): Promise<Booking> {
  if (!input.accepted)
    return fail(
      "ACCEPTANCE_REQUIRED",
      "Primero confirma el resumen de la cita.",
    );
  if (!input.customerRef.trim() || !input.idempotencyKey.trim())
    return fail(
      "INVALID_INPUT",
      "Falta la referencia del cliente o de la operación.",
    );
  if (
    !["web", "whatsapp", "messenger", "instagram", "telegram"].includes(
      input.channel,
    )
  )
    return fail("INVALID_INPUT", "Canal desconocido.");
  const service = config.services.find((s) => s.id === input.serviceId);
  const professional = config.professionals.find(
    (p) => p.id === input.professionalId,
  );
  if (
    !service ||
    !professional ||
    !professional.serviceIds.includes(service.id)
  )
    return fail(
      "INVALID_SERVICE",
      "El servicio o profesional no está disponible en este negocio.",
    );
  if (
    ![service.durationMinutes, config.slotStepMinutes].every(
      (n) => Number.isInteger(n) && n > 0,
    ) ||
    ![service.bufferBeforeMinutes, service.bufferAfterMinutes].every(
      (n) => Number.isInteger(n) && n >= 0,
    )
  ) {
    return fail("BAD_CONFIG", "Duraciones o intervalos de reserva inválidos.");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      input.startAt,
    )
  ) {
    return fail(
      "INVALID_TIME",
      "La fecha necesita una zona horaria explícita.",
    );
  }
  const start = new Date(input.startAt);
  const calendarDay = new Date(input.startAt.slice(0, 10) + "T00:00:00Z");
  if (
    !Number.isFinite(calendarDay.getTime()) ||
    calendarDay.toISOString().slice(0, 10) !== input.startAt.slice(0, 10)
  )
    return fail("INVALID_TIME", "La fecha no existe en el calendario.");
  if (
    !Number.isFinite(start.getTime()) ||
    start.getUTCSeconds() !== 0 ||
    start.getUTCMilliseconds() !== 0
  )
    return fail("INVALID_TIME", "La cita debe comenzar en un minuto válido.");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        service: service.id,
        professional: professional.id,
        customer: input.customerRef,
        start: start.toISOString(),
        channel: input.channel,
        meeting: input.meeting,
      }),
    )
    .digest("hex");
  // Las reentregas deben devolver la reserva original incluso si su fecha ya pasó.
  const previous = (await repo.list(config.id)).find(
    (b) => b.idempotencyKey === input.idempotencyKey,
  );
  if (previous) {
    if (previous.requestFingerprint !== fingerprint)
      return fail(
        "IDEMPOTENCY_CONFLICT",
        "Esta operación ya se usó con otros datos.",
      );
    return previous;
  }
  if (start <= now) return fail("PAST_TIME", "Elige una hora futura.");
  const end = new Date(start.getTime() + service.durationMinutes * 60_000);
  const blockedStart = new Date(
    start.getTime() - service.bufferBeforeMinutes * 60_000,
  );
  const blockedEnd = new Date(
    end.getTime() + service.bufferAfterMinutes * 60_000,
  );
  const localStart = localTime(blockedStart, config.timeZone);
  const localEnd = localTime(blockedEnd, config.timeZone);
  const appointmentStart = localTime(start, config.timeZone);
  if (appointmentStart.minute % config.slotStepMinutes !== 0)
    return fail(
      "INVALID_TIME",
      "La hora no coincide con los intervalos de la agenda.",
    );
  if (
    localStart.date !== localEnd.date ||
    config.closedDates.includes(localStart.date) ||
    !fits(config.hours, localStart.day, localStart.minute, localEnd.minute) ||
    !fits(
      professional.hours,
      localStart.day,
      localStart.minute,
      localEnd.minute,
    )
  ) {
    return fail(
      "OUTSIDE_HOURS",
      "La cita y su tiempo de preparación deben caber en el horario disponible.",
    );
  }
  return repo.insertIfAvailable({
    id: randomUUID(),
    tenantId: config.id,
    serviceId: service.id,
    professionalId: professional.id,
    customerRef: input.customerRef,
    channel: input.channel,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    blockedStartAt: blockedStart.toISOString(),
    blockedEndAt: blockedEnd.toISOString(),
    status:
      config.confirmation === "automatic"
        ? "confirmed"
        : "pending_confirmation",
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: fingerprint,
    ...(input.meeting ? { meeting: input.meeting } : {}),
  });
}

/** Adaptador de demostración y pruebas: no es una base de datos ni sirve entre servidores. */
export class InMemoryBookingRepository implements BookingRepository {
  private bookings: Booking[] = [];
  async list(tenantId: string) {
    return this.bookings
      .filter((b) => b.tenantId === tenantId)
      .map((b) => ({ ...b }));
  }
  async insertIfAvailable(booking: Booking) {
    // Sin awaits entre comprobar y guardar: indivisible dentro de este proceso.
    const same = this.bookings.find(
      (b) =>
        b.tenantId === booking.tenantId &&
        b.idempotencyKey === booking.idempotencyKey,
    );
    if (same) {
      if (same.requestFingerprint !== booking.requestFingerprint)
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "Operación repetida con otros datos.",
        );
      return { ...same };
    }
    if (
      this.bookings.some(
        (b) =>
          b.tenantId === booking.tenantId &&
          b.professionalId === booking.professionalId &&
          b.status !== "cancelled" &&
          booking.blockedStartAt < b.blockedEndAt &&
          booking.blockedEndAt > b.blockedStartAt,
      )
    ) {
      return fail("SLOT_TAKEN", "Ese horario acaba de ocuparse. Elige otro.");
    }
    this.bookings.push({ ...booking });
    return { ...booking };
  }
  async cancel(tenantId: string, bookingId: string) {
    const booking = this.bookings.find(
      (b) => b.tenantId === tenantId && b.id === bookingId,
    );
    if (!booking)
      return fail("NOT_FOUND", "La cita no existe en este negocio.");
    booking.status = "cancelled";
  }
}
