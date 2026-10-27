import type { BusinessConfig, Hours } from "../core/types.ts";

const hours = (["Mon", "Tue", "Wed", "Thu", "Fri"] as Hours["day"][]).map(
  (day) => ({ day, from: "09:00", to: "17:00" }),
);
export interface Profile {
  business: BusinessConfig;
  owner: string;
  email: string;
  phone: string;
  schedulingEnabled: boolean;
  meetingUrl: string;
  meetingNotes: string;
}
export const initialProfile: Profile = {
  owner: "David Cevallos",
  email: "jimdav1506ceva@gmail.com",
  phone: "593979107716",
  schedulingEnabled: true,
  meetingUrl: "",
  meetingNotes:
    "David compartirá el enlace de la videollamada antes de la cita.",
  business: {
    id: "manabit",
    name: "Manabit",
    sector: "software",
    timeZone: "America/Guayaquil",
    slotStepMinutes: 15,
    confirmation: "automatic",
    closedDates: [],
    hours,
    labels: {
      customer: "Contacto",
      provider: "Asesor",
      appointment: "Diagnóstico",
    },
    brand: {
      logo: "/brand/manabit-horizontal.svg",
      accent: "#D4573F",
      displayName: "Manabit Sistema",
    },
    services: [
      {
        id: "diagnostico",
        name: "Diagnóstico gratuito",
        durationMinutes: 15,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      },
    ],
    professionals: [
      {
        id: "david",
        name: "David Cevallos",
        serviceIds: ["diagnostico"],
        hours,
      },
    ],
  },
};
export const plans = [
  {
    name: "Chiflebit",
    description:
      "Presencia web con diseño propio, contacto por WhatsApp y seguimiento de mensajes.",
  },
  {
    name: "Tongabit",
    description:
      "Página, reservas, confirmaciones, panel y seguimiento mensual.",
  },
  {
    name: "Toquillabit",
    description: "Software de gestión adaptado a los procesos de tu negocio.",
  },
];
export const agentRoles = [
  {
    id: "manabit_recepcion",
    name: "Recepción",
    audience: "clientes",
    description: "Recibe, identifica la necesidad y dirige al especialista.",
    tools: ["conocer_manabit"],
  },
  {
    id: "manabit_asesor",
    name: "Asesor comercial",
    audience: "clientes",
    description:
      "Explica los planes y prepara el diagnóstico; no inventa precios.",
    tools: ["conocer_manabit"],
  },
  {
    id: "manabit_agenda",
    name: "Agenda",
    audience: "clientes",
    description:
      "Consulta horarios y propone fecha, modalidad y lugar. El sistema confirma tras la aceptación.",
    tools: [
      "conocer_manabit",
      "consultar_disponibilidad",
      "proponer_diagnostico",
      "derivar_a_david",
    ],
  },
  {
    id: "manabit_soporte",
    name: "Soporte",
    audience: "clientes",
    description:
      "Registra una tarea real para David y pausa la automatización.",
    tools: ["derivar_a_david"],
  },
  {
    id: "manabit_gerente",
    name: "Gerente",
    audience: "David",
    description: "Lee resultados verificables y prioriza pendientes internos.",
    tools: ["consultar_resultados", "conocer_manabit"],
  },
  {
    id: "manabit_ideas",
    name: "Ideas",
    audience: "David",
    description: "Prepara borradores sobre servicios y preguntas frecuentes.",
    tools: ["conocer_manabit", "guardar_borrador"],
  },
] as const;
