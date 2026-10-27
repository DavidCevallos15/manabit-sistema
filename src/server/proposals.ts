import { randomBytes } from "node:crypto";
import type { Conversation } from "./conversations.ts";
import { availableSlots, reserve, profile } from "./bookings.ts";
import { getRecord, putRecord } from "./db.ts";

interface Proposal {
  code: string;
  conversation: string;
  startAt: string;
  mode: "videollamada" | "presencial";
  address?: string;
  expiresAt: number;
}
export async function propose(
  c: Conversation,
  values: {
    startAt: string;
    mode: "videollamada" | "presencial";
    address?: string;
  },
) {
  const slots = await availableSlots(values.startAt.slice(0, 10));
  if (
    !slots.some(
      (s) =>
        new Date(s.startAt).getTime() === new Date(values.startAt).getTime(),
    )
  )
    throw new Error("Ese horario no está disponible.");
  if (
    values.mode === "presencial" &&
    (!values.address || values.address.length < 8)
  )
    throw new Error(
      "Falta el nombre y la dirección del negocio para la visita.",
    );
  const code = randomBytes(4).toString("hex").toUpperCase();
  const proposal: Proposal = {
    code,
    conversation: c.id,
    ...values,
    expiresAt: Date.now() + 15 * 60_000,
  };
  await putRecord("proposal", code, proposal);
  const when = new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(values.startAt));
  const p = await profile();
  return {
    code,
    summary: `Diagnóstico gratuito de ${p.business.services[0]?.durationMinutes} minutos con David: ${when}. ${values.mode === "presencial" ? `Visita a ${values.address}` : p.meetingUrl || p.meetingNotes}.`,
    confirmation: `Para aceptar, escribe exactamente CONFIRMAR ${code}. Al aceptar autorizas usar tus datos para gestionar esta cita, sin campañas promocionales. La disponibilidad se verifica de nuevo al confirmar.`,
    expiresInMinutes: 15,
  };
}
export async function confirmProposal(c: Conversation, code: string) {
  const p = await getRecord<Proposal>("proposal", code);
  if (!p || p.conversation !== c.id || p.expiresAt < Date.now())
    return "La propuesta ya venció o no pertenece a esta conversación. Elige un nuevo horario.";
  try {
    const b = await reserve({
      contact: c.contact,
      channel: c.channel,
      startAt: p.startAt,
      mode: p.mode,
      address: p.address,
      accepted: true,
      key: `proposal:${code}`,
    });
    const when = new Intl.DateTimeFormat("es-EC", {
      timeZone: "America/Guayaquil",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(b.startAt));
    return `Tu diagnóstico con David quedó registrado para ${when}. Lugar: ${b.meeting?.location}. Referencia: ${b.id.slice(0, 8)}.`;
  } catch (e) {
    return e instanceof Error
      ? e.message
      : "No se pudo guardar la cita. Elige otro horario.";
  }
}
