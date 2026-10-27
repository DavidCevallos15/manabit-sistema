import { BookingError, bookAppointment } from "../core/booking.ts";
import type { Booking, BookingRepository, Channel } from "../core/types.ts";
import { getRecord, putRecord, store } from "./db.ts";
import { initialProfile, type Profile } from "./profile.ts";

export const persistentBookings: BookingRepository = {
  list: async (tenant) => (await store()).bookings.list(tenant),
  insertIfAvailable: async (booking) =>
    (await store()).bookings.insertIfAvailable(booking),
  cancel: async (tenant, id) => (await store()).bookings.cancel(tenant, id),
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
