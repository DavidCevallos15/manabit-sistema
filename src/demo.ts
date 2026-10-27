import { bookAppointment, InMemoryBookingRepository } from "./core/booking.ts";
import { clinic, barber } from "./core/presets.ts";

const repo = new InMemoryBookingRepository();
const now = new Date("2030-01-01T00:00:00Z");
for (const business of [clinic, barber]) {
  const service = business.services[0]!;
  const booking = await bookAppointment(
    business,
    {
      customerRef: "persona-demo",
      serviceId: service.id,
      professionalId: "profesional-1",
      startAt: "2030-01-07T10:00:00-05:00",
      channel: "web",
      accepted: true,
      idempotencyKey: "reserva-demo",
    },
    repo,
    now,
  );
  console.log(
    `${business.name}: ${business.labels.appointment} ${booking.status} · ${service.name} · ${service.durationMinutes} min`,
  );
  console.log(`Inicio UTC: ${booking.startAt} · Fin UTC: ${booking.endAt}`);
}
console.log(
  "Demostración local: no se guardan datos al salir y no se envían mensajes.",
);
