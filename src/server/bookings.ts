import { BookingError, bookAppointment } from "../core/booking.ts";
import type { Booking, BookingRepository, Channel } from "../core/types.ts";
import { database, getRecord, putRecord } from "./db.ts";
import { initialProfile, type Profile } from "./profile.ts";

export const persistentBookings: BookingRepository = {
  async list(tenant) {
    const db = await database();
    const r = await db.query(
      "SELECT payload FROM appointments WHERE tenant=$1 ORDER BY blocked_start",
      [tenant],
    );
    return r.rows.map((row) => JSON.parse(String(row.payload)) as Booking);
  },
  async insertIfAvailable(booking) {
    const db = await database();
    try {
      const same = (await this.list(booking.tenantId)).find(
        (b) => b.idempotencyKey === booking.idempotencyKey,
      );
      if (same) {
        if (same.requestFingerprint !== booking.requestFingerprint)
          throw new BookingError(
            "IDEMPOTENCY_CONFLICT",
            "La operación ya tiene otros datos.",
          );
        return same;
      }
      // SQLite ejecuta este INSERT...SELECT de forma atómica; PostgreSQL añade exclusión de rangos.
      const r = await db.query(
        `INSERT INTO appointments(tenant,id,professional,blocked_start,blocked_end,status,idem,payload)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS
        (SELECT 1 FROM appointments WHERE tenant=$9 AND professional=$10 AND status<>'cancelled' AND blocked_start<$11 AND blocked_end>$12)`,
        [
          booking.tenantId,
          booking.id,
          booking.professionalId,
          booking.blockedStartAt,
          booking.blockedEndAt,
          booking.status,
          booking.idempotencyKey,
          JSON.stringify(booking),
          booking.tenantId,
          booking.professionalId,
          booking.blockedEndAt,
          booking.blockedStartAt,
        ],
      );
      if (!r.changes)
        throw new BookingError(
          "SLOT_TAKEN",
          "Ese horario se acaba de ocupar. Elige otro.",
        );
      return booking;
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        ["23505", "SQLITE_CONSTRAINT_UNIQUE"].includes(String(e.code))
      ) {
        const same = (await this.list(booking.tenantId)).find(
          (b) => b.idempotencyKey === booking.idempotencyKey,
        );
        if (same?.requestFingerprint === booking.requestFingerprint)
          return same;
      }
      if (e && typeof e === "object" && "code" in e && e.code === "23P01")
        throw new BookingError("SLOT_TAKEN", "Ese horario ya está ocupado.");
      throw e;
    }
  },
  async cancel(tenant, id) {
    const booking = (await this.list(tenant)).find((b) => b.id === id);
    if (!booking) throw new BookingError("NOT_FOUND", "No existe esa cita.");
    booking.status = "cancelled";
    const db = await database();
    await db.query(
      "UPDATE appointments SET status=$1,payload=$2 WHERE tenant=$3 AND id=$4",
      [booking.status, JSON.stringify(booking), tenant, id],
    );
  },
};
export async function profile() {
  return (
    (await getRecord<Profile>("settings", "profile")) ??
    structuredClone(initialProfile)
  );
}
export async function saveProfile(value: Profile) {
  await putRecord("settings", "profile", value);
}

export async function availableSlots(date: string) {
  const p = await profile();
  if (!p.schedulingEnabled) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Fecha inválida.");
  const existing = await persistentBookings.list("manabit");
  const slots: { startAt: string; label: string }[] = [];
  // Manabit opera en Ecuador continental (UTC-5 sin cambios estacionales).
  for (let hour = 0; hour < 24; hour++)
    for (let min = 0; min < 60; min += p.business.slotStepMinutes) {
      const label = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      const startAt = `${date}T${label}:00-05:00`;
      const probe: BookingRepository = {
        list: async () => existing,
        cancel: async () => {},
        insertIfAvailable: async (b) => {
          if (
            existing.some(
              (e) =>
                e.status !== "cancelled" &&
                b.blockedStartAt < e.blockedEndAt &&
                b.blockedEndAt > e.blockedStartAt,
            )
          )
            throw new BookingError("SLOT_TAKEN", "Ocupado");
          return b;
        },
      };
      try {
        await bookAppointment(
          p.business,
          {
            customerRef: "availability",
            serviceId: "diagnostico",
            professionalId: "david",
            startAt,
            channel: "web",
            accepted: true,
            idempotencyKey: `probe:${date}:${label}`,
          },
          probe,
        );
        slots.push({ startAt, label });
      } catch (e) {
        if (!(e instanceof BookingError)) throw e;
      }
    }
  return slots;
}
export async function reserve(input: {
  contact: string;
  channel: Channel;
  startAt: string;
  mode: "videollamada" | "presencial";
  address?: string;
  accepted: boolean;
  key: string;
}) {
  const p = await profile();
  if (!p.schedulingEnabled)
    throw new Error(
      "La agenda está pausada. Escríbele a David para coordinar.",
    );
  if (new Date(input.startAt).getTime() > Date.now() + 90 * 86400_000)
    throw new Error("Elige un diagnóstico dentro de los próximos 90 días.");
  const location =
    input.mode === "presencial"
      ? input.address?.trim()
      : p.meetingUrl || p.meetingNotes;
  if (!location || (input.mode === "presencial" && location.length < 8))
    throw new Error(
      "Escribe el nombre del negocio y su dirección para la visita.",
    );
  const booking = await bookAppointment(
    p.business,
    {
      serviceId: "diagnostico",
      professionalId: "david",
      customerRef: input.contact,
      startAt: input.startAt,
      channel: input.channel,
      accepted: input.accepted,
      idempotencyKey: input.key,
      meeting: { mode: input.mode, location },
    },
    persistentBookings,
  );
  await putRecord("consent", booking.id, {
    contact: input.contact,
    purpose: "gestionar_diagnostico",
    booking: booking.id,
    acceptedAt: new Date().toISOString(),
    promotional: false,
  });
  return booking;
}
