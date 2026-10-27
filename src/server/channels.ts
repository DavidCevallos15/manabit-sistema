import { createHmac, randomUUID } from "node:crypto";
import type { Channel } from "../core/types.ts";
import { safeEqual } from "./auth.ts";
import {
  getRecord,
  listRecords,
  putRecord,
  claimRecord,
  acquireLease,
  releaseLease,
} from "./db.ts";
import {
  ensureConversation,
  receiveMessage,
  withConversationLock,
  type Conversation,
} from "./conversations.ts";

export interface Job {
  id: string;
  conversation: string;
  text: string;
  event: string;
  status: "pending" | "done" | "failed";
  attempts: number;
  error?: string;
}
const required: Record<string, string[]> = {
  whatsapp: [
    "META_APP_SECRET",
    "META_VERIFY_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
  ],
  instagram: [
    "META_APP_SECRET",
    "META_VERIFY_TOKEN",
    "INSTAGRAM_ACCOUNT_ID",
    "INSTAGRAM_ACCESS_TOKEN",
  ],
  messenger: [
    "META_APP_SECRET",
    "META_VERIFY_TOKEN",
    "MESSENGER_PAGE_ID",
    "MESSENGER_ACCESS_TOKEN",
  ],
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
};
export async function channelStatus() {
  const connections = await listRecords<{
    channel: string;
    lastEventAt: string;
  }>("connection");
  return (
    ["web", "whatsapp", "instagram", "messenger", "telegram"] as Channel[]
  ).map((id) => {
    const fields = required[id] || [];
    const missing = fields.filter((name) => !process.env[name]);
    const receipt = connections.find((c) => c.channel === id);
    return {
      id,
      status:
        id === "web"
          ? "active"
          : receipt
            ? "receiving"
            : !missing.length
              ? "configured"
              : "disconnected",
      missing,
      lastEventAt: receipt?.lastEventAt,
      automaticReplies:
        id === "web" || process.env.SOCIAL_AUTOMATION_ENABLED === "true",
    };
  });
}
export function verifyMetaSignature(body: string, signature: string | null) {
  const secret = process.env.META_APP_SECRET;
  return (
    !!secret &&
    !!signature &&
    safeEqual(
      `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
      signature,
    )
  );
}
export function extractMeta(payload: Record<string, unknown>) {
  const result: {
    channel: Channel;
    account: string;
    sender: string;
    name: string;
    text: string;
    event: string;
  }[] = [];
  const body = payload as {
    object?: string;
    entry?: {
      id?: string;
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          contacts?: { profile?: { name?: string } }[];
          messages?: {
            id?: string;
            from?: string;
            type?: string;
            text?: { body?: string };
          }[];
        };
      }[];
      messaging?: {
        sender?: { id?: string };
        message?: { mid?: string; is_echo?: boolean; text?: string };
      }[];
    }[];
  };
  for (const entry of body.entry || []) {
    for (const change of entry.changes || [])
      for (const m of change.value?.messages || []) {
        const account = change.value?.metadata?.phone_number_id;
        if (
          !account ||
          account !== process.env.WHATSAPP_PHONE_NUMBER_ID ||
          !m.id ||
          !m.from
        )
          continue;
        result.push({
          channel: "whatsapp",
          account,
          sender: m.from,
          name:
            change.value?.contacts?.[0]?.profile?.name ||
            "Contacto de WhatsApp",
          text:
            m.text?.body || "[Mensaje multimedia: requiere atención de David]",
          event: m.id,
        });
      }
    const instagram = body.object === "instagram";
    const expected = instagram
      ? process.env.INSTAGRAM_ACCOUNT_ID
      : process.env.MESSENGER_PAGE_ID;
    if (!expected || entry.id !== expected) continue;
    for (const m of entry.messaging || [])
      if (m.sender?.id && m.message?.mid && !m.message.is_echo)
        result.push({
          channel: instagram ? "instagram" : "messenger",
          account: expected,
          sender: m.sender.id,
          name: instagram ? "Contacto de Instagram" : "Contacto de Messenger",
          text:
            m.message.text ||
            "[Mensaje multimedia: requiere atención de David]",
          event: m.message.mid,
        });
  }
  return result;
}
export async function enqueueIncoming(value: {
  channel: Channel;
  sender: string;
  name: string;
  text: string;
  event: string;
}) {
  const id = `${value.channel}:${value.event}`;
  if (await getRecord("job", id)) return;
  const c = await ensureConversation(value.sender, value.channel, value.name);
  const job: Job = {
    id,
    conversation: c.id,
    text: value.text,
    event: value.event,
    status: "pending",
    attempts: 0,
  };
  await claimRecord("job", id, job);
  await putRecord("receipt", id, { at: new Date().toISOString() });
  await putRecord("connection", value.channel, {
    channel: value.channel,
    lastEventAt: new Date().toISOString(),
  });
}
export async function sendOutgoing(
  c: Conversation,
  text: string,
  messageId: string,
) {
  if (c.channel === "web" || c.mode === "simulation") return "local" as const;
  if (process.env.SOCIAL_AUTOMATION_ENABLED !== "true")
    throw new Error(
      "La respuesta social automática está pausada en configuración.",
    );
  if (
    Date.now() - new Date(c.lastInboundAt).getTime() > 24 * 60 * 60_000 &&
    c.channel !== "telegram"
  )
    throw new Error(
      "La ventana de respuesta terminó. Revisa el canal y las plantillas autorizadas.",
    );
  if (await getRecord("delivery", messageId)) return "sent" as const;
  const version = process.env.META_GRAPH_VERSION;
  if (c.channel !== "telegram" && !/^v\d+\.\d+$/.test(version || ""))
    throw new Error(
      "Configura META_GRAPH_VERSION vigente para tu aplicación de Meta.",
    );
  let url: string;
  let token: string | undefined;
  let body: object;
  if (c.channel === "whatsapp") {
    token = process.env.WHATSAPP_ACCESS_TOKEN;
    url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    body = {
      messaging_product: "whatsapp",
      to: c.contact,
      type: "text",
      text: { body: text },
    };
  } else if (c.channel === "instagram") {
    token = process.env.INSTAGRAM_ACCESS_TOKEN;
    url = `https://graph.instagram.com/${version}/${process.env.INSTAGRAM_ACCOUNT_ID}/messages`;
    body = { recipient: { id: c.contact }, message: { text } };
  } else if (c.channel === "messenger") {
    token = process.env.MESSENGER_ACCESS_TOKEN;
    url = `https://graph.facebook.com/${version}/${process.env.MESSENGER_PAGE_ID}/messages`;
    body = {
      recipient: { id: c.contact },
      messaging_type: "RESPONSE",
      message: { text },
    };
  } else {
    token = process.env.TELEGRAM_BOT_TOKEN;
    url = `https://api.telegram.org/bot${token}/sendMessage`;
    body = { chat_id: c.contact, text };
  }
  if (!token) throw new Error("Falta la credencial del canal.");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(c.channel !== "telegram" ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`El proveedor rechazó el envío (${response.status}).`);
  await putRecord("delivery", messageId, {
    at: new Date().toISOString(),
    channel: c.channel,
  });
  return "sent" as const;
}
export async function runJobs() {
  const jobs = (await listRecords<Job>("job"))
    .filter((j) => j.status === "pending" && j.attempts < 5)
    .slice(0, 10);
  for (const candidate of jobs) {
    const token = randomUUID();
    if (!(await acquireLease(`job:${candidate.id}`, token))) continue;
    try {
      const job = await getRecord<Job>("job", candidate.id);
      if (!job || job.status !== "pending") continue;
      job.attempts++;
      try {
        await receiveMessage(job.conversation, job.text, job.event);
        await withConversationLock(job.conversation, async () => {
          const c = await getRecord<Conversation>(
            "conversation",
            job.conversation,
          );
          if (!c) throw new Error("No existe la conversación del evento.");
          const eventIndex = c.messages.findIndex((m) => m.id === job.event);
          const nextInbound = c.messages.findIndex(
            (m, index) => index > eventIndex && m.role === "customer",
          );
          const message = c.messages
            .slice(eventIndex + 1, nextInbound < 0 ? undefined : nextInbound)
            .find((m) => m.role === "agent");
          const ownerReplied = c.messages
            .slice(eventIndex + 1)
            .some((m) => m.role === "owner");
          if (message && c.status !== "closed" && !ownerReplied) {
            message.delivery = await sendOutgoing(c, message.text, message.id);
            await putRecord("conversation", c.id, c);
          }
        });
        job.status = "done";
      } catch (e) {
        job.status = "failed";
        job.error = e instanceof Error ? e.message : "No se procesó el evento.";
      }
      await putRecord("job", job.id, job);
    } finally {
      await releaseLease(`job:${candidate.id}`, token);
    }
  }
  return jobs.length;
}
