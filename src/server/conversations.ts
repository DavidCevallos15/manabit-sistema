import { createHash, randomUUID } from "node:crypto";
import type { Channel } from "../core/types.ts";
import {
  acquireLease,
  releaseLease,
  claimRecord,
  getRecord,
  listRecords,
  putRecord,
} from "./db.ts";
import { agentConfigured, askGoogle } from "./google-agent.ts";
import { plans } from "./profile.ts";
import { profile } from "./bookings.ts";

export interface Message {
  id: string;
  role: "customer" | "agent" | "owner" | "system";
  text: string;
  author: string;
  at: string;
  delivery?: "local" | "sent" | "failed";
}
export interface Conversation {
  id: string;
  contact: string;
  name: string;
  channel: Channel;
  status: "open" | "human" | "closed";
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  lastInboundAt: string;
  mode: "live" | "simulation";
  remoteSession?: string;
  pending?: string;
}
export interface Task {
  id: string;
  title: string;
  conversationId?: string;
  status: "open" | "done";
  at: string;
}

export async function ensureConversation(
  contact: string,
  channel: Channel = "web",
  name = "Visitante web",
  mode: "live" | "simulation" = "live",
) {
  const id = createHash("sha256")
    .update(`manabit:${channel}:${contact}`)
    .digest("hex")
    .slice(0, 24);
  const existing = await getRecord<Conversation>("conversation", id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const p = await profile();
  const conversation: Conversation = {
    id,
    contact,
    name,
    channel,
    status: "open",
    messages: [
      {
        id: randomUUID(),
        role: "agent",
        author: "Recepción de Manabit",
        at: now,
        text: `Hola, soy el asistente de Manabit. Puedo explicarte los planes o ayudarte a agendar un diagnóstico gratuito de ${p.business.services[0]?.durationMinutes} minutos con David. ¿Qué necesita tu negocio?`,
        delivery: "local",
      },
    ],
    createdAt: now,
    updatedAt: now,
    lastInboundAt: now,
    mode,
  };
  await claimRecord("conversation", id, conversation);
  return (await getRecord<Conversation>("conversation", id)) ?? conversation;
}
export async function createTask(title: string, conversationId?: string) {
  const task: Task = {
    id: randomUUID(),
    title,
    conversationId,
    status: "open",
    at: new Date().toISOString(),
  };
  await putRecord("task", task.id, task);
  return task;
}
export async function handoff(id: string, reason: string) {
  const c = await getRecord<Conversation>("conversation", id);
  if (!c) throw new Error("No existe la conversación.");
  if (c.status !== "human") await createTask(reason, id);
  c.status = "human";
  c.updatedAt = new Date().toISOString();
  await putRecord("conversation", id, c);
  return c;
}
export function guidedReply(
  text: string,
  duration = 15,
  from = "09:00",
  to = "17:00",
) {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/david|humano|persona|problema|reclamo|urgente/.test(t))
    return {
      author: "manabit_soporte",
      human: true,
      text: "Voy a dejar tu consulta a David. La conversación quedará pendiente de su atención y la respuesta automática se pausa.",
    };
  if (/precio|plan|chifle|tonga|toquilla|servicio|cuesta|vende/.test(t))
    return {
      author: "manabit_asesor",
      text: `${plans.map((p) => `${p.name}: ${p.description}`).join("\n\n")}\n\nEl precio se define después de revisar tu negocio. Podemos empezar con un diagnóstico gratuito de ${duration} minutos.`,
    };
  if (
    /cita|agend|hora|cuando|reserva|diagnostico|manana|lunes|martes|miercoles|jueves|viernes/.test(
      t,
    )
  )
    return {
      author: "manabit_agenda",
      text: `Los diagnósticos duran ${duration} minutos y David atiende de lunes a viernes, de ${from} a ${to}, hora de Ecuador. Puedes elegir videollamada o visita a tu negocio. Usa «Elegir horario» para ver disponibilidad real y confirmar fecha y lugar.`,
    };
  return {
    author: "manabit_recepcion",
    text: "En Manabit conectamos página web, reservas y atención para que tu negocio reciba y organice consultas. Puedo explicarte Chiflebit, Tongabit y Toquillabit, o ayudarte a elegir un diagnóstico gratuito con David. ¿Qué tipo de negocio tienes?",
  };
}
// Serializa turnos locales; en Cloud Run cada conversación se reclama además en la base de datos.
const turns = new Map<string, Promise<unknown>>();
export async function withConversationLock<T>(
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = turns.get(id) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const token = randomUUID();
      if (!(await acquireLease(`conversation:${id}`, token)))
        throw new Error(
          "Esta conversación está procesando otro mensaje. Reintenta en unos segundos.",
        );
      try {
        return await operation();
      } finally {
        await releaseLease(`conversation:${id}`, token);
      }
    });
  turns.set(id, next);
  try {
    return await next;
  } finally {
    if (turns.get(id) === next) turns.delete(id);
  }
}
export async function receiveMessage(
  id: string,
  text: string,
  eventId: string,
) {
  return withConversationLock(id, () => processMessage(id, text, eventId));
}
async function processMessage(id: string, text: string, eventId: string) {
  let c = await getRecord<Conversation>("conversation", id);
  if (!c) throw new Error("No existe la conversación.");
  const exists = c.messages.some((m) => m.id === eventId);
  if (exists && c.pending !== eventId) return c;
  const now = new Date().toISOString();
  if (!exists)
    c.messages.push({
      id: eventId,
      role: "customer",
      author: c.name,
      text,
      at: now,
    });
  c.updatedAt = now;
  c.lastInboundAt = now;
  c.pending = eventId;
  await putRecord("conversation", id, c);
  if (c.status === "human" || c.status === "closed") {
    delete c.pending;
    await putRecord("conversation", id, c);
    return c;
  }
  let answer: { text: string; author: string; human?: boolean };
  try {
    const confirmation = text.trim().match(/^CONFIRMAR\s+([A-F0-9]{8})$/i);
    if (confirmation) {
      const { confirmProposal } = await import("./proposals.ts");
      answer = {
        text: await confirmProposal(c, confirmation[1]!),
        author: "manabit_agenda",
      };
    } else if (agentConfigured()) {
      const result = await askGoogle({
        user: `manabit:${id}`,
        session: c.remoteSession,
        message: text,
      });
      c.remoteSession = result.session;
      answer = { text: result.text, author: "Google ADK · Manabit" };
      // Una herramienta del agente puede haber cambiado el estado mientras respondía.
      const fresh = await getRecord<Conversation>("conversation", id);
      if (fresh) c = { ...fresh, remoteSession: result.session };
    } else {
      const p = await profile();
      answer = guidedReply(
        text,
        p.business.services[0]?.durationMinutes,
        p.business.hours[0]?.from,
        p.business.hours[0]?.to,
      );
    }
  } catch {
    answer = {
      text: "No pude completar la respuesta automática. Dejé tu consulta para que David la revise; puedes seguir escribiendo aquí.",
      author: "manabit_soporte",
      human: true,
    };
  }
  if (answer.human) {
    await handoff(id, `Revisar consulta de ${c.name}`);
    c.status = "human";
  }
  c.messages.push({
    id: randomUUID(),
    role: "agent",
    text: answer.text,
    author: answer.author,
    at: new Date().toISOString(),
    delivery: "local",
  });
  delete c.pending;
  c.updatedAt = new Date().toISOString();
  await putRecord("conversation", id, c);
  return c;
}
export async function metrics() {
  const conversations = await listRecords<Conversation>("conversation");
  const tasks = await listRecords<Task>("task");
  const { persistentBookings } = await import("./bookings.ts");
  const bookings = await persistentBookings.list("manabit");
  return {
    conversations: conversations.length,
    waiting: conversations.filter((c) => c.status === "human").length,
    confirmed: bookings.filter((b) => b.status === "confirmed").length,
    cancelled: bookings.filter((b) => b.status === "cancelled").length,
    tasks: tasks.filter((t) => t.status === "open").length,
    simulated: conversations.filter((c) => c.mode === "simulation").length,
  };
}
