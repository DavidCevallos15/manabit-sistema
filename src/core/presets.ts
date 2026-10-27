import type { BusinessConfig, Hours } from "./types.ts";

const hours: Hours[] = ["Mon", "Tue", "Wed", "Thu", "Fri"].flatMap((day) => [
  { day: day as Hours["day"], from: "09:00", to: "13:00" },
  { day: day as Hours["day"], from: "14:00", to: "18:00" },
]);

/** Datos de ejemplo. Las duraciones y horarios se confirman con cada negocio. */
export const clinic: BusinessConfig = {
  id: "consultorio-demo",
  name: "Consultorio de demostración",
  sector: "consultorio",
  timeZone: "America/Guayaquil",
  slotStepMinutes: 10,
  confirmation: "automatic",
  closedDates: [],
  hours,
  labels: {
    customer: "Paciente",
    provider: "Profesional",
    appointment: "Cita",
  },
  brand: {
    logo: null,
    accent: "#D4573F",
    displayName: "Consultorio de demostración",
  },
  services: [
    {
      id: "consulta",
      name: "Consulta inicial",
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 10,
    },
    {
      id: "control",
      name: "Control",
      durationMinutes: 20,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    },
  ],
  professionals: [
    {
      id: "profesional-1",
      name: "Profesional de demostración",
      serviceIds: ["consulta", "control"],
      hours,
    },
  ],
};

export const barber: BusinessConfig = {
  ...clinic,
  id: "barberia-demo",
  name: "Barbería de demostración",
  sector: "barberia",
  slotStepMinutes: 15,
  labels: { customer: "Cliente", provider: "Barbero", appointment: "Reserva" },
  brand: {
    logo: null,
    accent: "#D4573F",
    displayName: "Barbería de demostración",
  },
  services: [
    {
      id: "corte",
      name: "Corte",
      durationMinutes: 45,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    },
  ],
  professionals: [
    {
      id: "profesional-1",
      name: "Barbero de demostración",
      serviceIds: ["corte"],
      hours,
    },
  ],
};
