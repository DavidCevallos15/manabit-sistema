import { randomUUID, createHash } from "node:crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { BookingError } from "../core/booking.ts";
import {
  owner,
  localAdmin,
  contactIdentity,
  safeEqual,
  sign,
  sameOrigin,
  toolAuthorized,
} from "./auth.ts";
import {
  availableSlots,
  persistentBookings,
  profile,
  reserve,
  saveProfile,
} from "./bookings.ts";
import { agentRoles, plans } from "./profile.ts";
import {
  ensureConversation,
  receiveMessage,
  handoff,
  metrics,
  withConversationLock,
  type Conversation,
  type Task,
} from "./conversations.ts";
import { consumeLimit, getRecord, listRecords, putRecord } from "./db.ts";
import { agentConfigured, askGoogle } from "./google-agent.ts";
import {
  channelStatus,
  enqueueIncoming,
  extractMeta,
  runJobs,
  sendOutgoing,
  verifyMetaSignature,
  type Job,
} from "./channels.ts";
import { propose } from "./proposals.ts";

const channel = z.enum([
  "web",
  "whatsapp",
  "instagram",
  "messenger",
  "telegram",
]);
const bookingSchema = z.object({
  startAt: z.string().max(40),
  mode: z.enum(["videollamada", "presencial"]),
  address: z.string().max(300).optional(),
  accepted: z.literal(true),
  key: z.string().min(8).max(100),
});
function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function ip(req: NextRequest) {
  return createHash("sha256")
    .update(
      req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local",
    )
    .digest("hex")
    .slice(0, 24);
}
async function body(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 48_000) throw new Error("La petición es demasiado grande.");
  return JSON.parse(raw || "{}");
}
function cookie(
  response: NextResponse,
  name: string,
  value: string,
  req: NextRequest,
  age: number,
) {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: age,
  });
  return response;
}
export async function handle(req: NextRequest) {
  const path = new URL(req.url).pathname.replace(/^\/api\//, "");
  const method = req.method;
  try {
    if (path === "health") return json({ ok: true, app: "manabit-sistema" });
    if (path === "worker/jobs" && method === "POST") {
      const key = process.env.WORKER_TOKEN;
      if (
        !key ||
        key.length < 32 ||
        !safeEqual(req.headers.get("authorization") || "", `Bearer ${key}`)
      )
        return json({ error: "Worker no autorizado." }, 401);
      return json({ processed: await runJobs() });
    }
    if (path === "webhooks/meta") {
      if (method === "GET") {
        const url = new URL(req.url);
        return process.env.META_VERIFY_TOKEN &&
          safeEqual(
            url.searchParams.get("hub.verify_token") || "",
            process.env.META_VERIFY_TOKEN,
          ) &&
          url.searchParams.get("hub.mode") === "subscribe"
          ? new Response(url.searchParams.get("hub.challenge") || "")
          : json({ error: "Verificación rechazada." }, 403);
      }
      if (method !== "POST")
        return json({ error: "Método no permitido." }, 405);
      const raw = await req.text();
      if (
        raw.length > 500_000 ||
        !verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))
      )
        return json({ error: "Firma no válida." }, 403);
      for (const event of extractMeta(JSON.parse(raw)))
        await enqueueIncoming(event);
      after(async () => {
        await runJobs();
      });
      return json({ received: true });
    }
    if (path === "webhooks/telegram" && method === "POST") {
      if (
        !process.env.TELEGRAM_WEBHOOK_SECRET ||
        !safeEqual(
          req.headers.get("x-telegram-bot-api-secret-token") || "",
          process.env.TELEGRAM_WEBHOOK_SECRET,
        )
      )
        return json({ error: "Verificación rechazada." }, 403);
      const value = await body(req);
      if (value.message?.text && value.message?.chat?.type === "private")
        await enqueueIncoming({
          channel: "telegram",
          sender: String(value.message.chat.id),
          name: value.message.from?.first_name || "Contacto de Telegram",
          text: String(value.message.text).slice(0, 8000),
          event: String(value.update_id),
        });
      after(async () => {
        await runJobs();
      });
      return json({ received: true });
    }
    if (path.startsWith("tools/")) return await tools(req, path);
    if (method !== "GET" && !sameOrigin(req))
      return json({ error: "Origen no permitido." }, 403);
    if (path === "auth/status")
      return json({ authenticated: owner(req), local: localAdmin(req) });
    if (path === "auth/login" && method === "POST") {
      if (!(await consumeLimit(`login:${ip(req)}`, 10, 600)))
        return json(
          { error: "Demasiados intentos. Espera unos minutos." },
          429,
        );
      const { password } = z
        .object({ password: z.string().max(200) })
        .parse(await body(req));
      if (
        !process.env.ADMIN_PASSWORD ||
        process.env.ADMIN_PASSWORD.length < 16 ||
        !safeEqual(password, process.env.ADMIN_PASSWORD)
      )
        return json({ error: "Clave no válida." }, 401);
      return cookie(
        json({ ok: true }),
        "manabit_owner",
        sign(`owner:${Date.now() + 12 * 3600_000}`),
        req,
        12 * 3600,
      );
    }
    if (path === "auth/logout" && method === "POST")
      return cookie(json({ ok: true }), "manabit_owner", "", req, 0);
    if (path === "public/config") {
      const p = await profile();
      return json({
        name: p.business.name,
        owner: p.owner,
        duration: p.business.services[0]?.durationMinutes,
        hours: p.business.hours[0],
        schedulingEnabled: p.schedulingEnabled,
        plans,
        timeZone: p.business.timeZone,
        meetingNotes: p.meetingNotes,
      });
    }
    if (path === "public/session" && method === "POST") {
      if (!(await consumeLimit(`sessions:${ip(req)}`, 20, 900)))
        return json(
          { error: "Espera unos minutos antes de volver a abrir el chat." },
          429,
        );
      const contact = contactIdentity(req) || `web:${randomUUID()}`;
      const c = await ensureConversation(contact);
      return cookie(
        json({ conversation: c, google: agentConfigured() }),
        "manabit_contact",
        sign(contact),
        req,
        30 * 86400,
      );
    }
    if (path === "public/slots") {
      if (!(await consumeLimit(`slots:${ip(req)}`, 120, 60)))
        return json(
          { error: "Espera unos segundos y vuelve a consultar." },
          429,
        );
      const date = new URL(req.url).searchParams.get("date") || "";
      return json({ slots: await availableSlots(date) });
    }
    if (path.startsWith("public/")) {
      const contact = contactIdentity(req);
      if (!contact)
        return json({ error: "Abre el chat para iniciar tu sesión." }, 401);
      const c = await ensureConversation(contact);
      if (path === "public/conversation")
        return json({ conversation: c, google: agentConfigured() });
      if (path === "public/message" && method === "POST") {
        if (!(await consumeLimit(`messages:${contact}`, 30, 1800)))
          return json(
            {
              error:
                "Llegaste al límite de mensajes de esta sesión. Espera un momento o contacta a David.",
            },
            429,
          );
        const value = z
          .object({
            text: z.string().trim().min(1).max(4000),
            event: z.string().min(8).max(100),
          })
          .parse(await body(req));
        return json({
          conversation: await receiveMessage(c.id, value.text, value.event),
          google: agentConfigured(),
        });
      }
      if (path === "public/book" && method === "POST") {
        const value = bookingSchema
          .extend({
            name: z.string().trim().min(2).max(100),
            contactDetail: z.string().trim().min(5).max(150),
          })
          .parse(await body(req));
        const booking = await reserve({ ...value, contact, channel: "web" });
        await withConversationLock(c.id, async () => {
          const fresh = await getRecord<Conversation>("conversation", c.id);
          if (fresh) {
            fresh.name = value.name;
            await putRecord("conversation", c.id, fresh);
          }
        });
        await putRecord("contact", contact, {
          id: contact,
          name: value.name,
          detail: value.contactDetail,
          at: new Date().toISOString(),
        });
        return json({ booking });
      }
      if (path === "public/booking.ics") {
        const id = new URL(req.url).searchParams.get("id");
        const b = (await persistentBookings.list("manabit")).find(
          (b) => b.id === id && b.customerRef === contact,
        );
        if (!b) return json({ error: "No existe la cita." }, 404);
        return calendar([b]);
      }
    }
    if (path.startsWith("admin/")) {
      if (!owner(req))
        return json({ error: "Inicia sesión para abrir el panel." }, 401);
      if (path === "admin/state")
        return json({
          profile: await profile(),
          contacts: await listRecords("contact"),
          conversations: await listRecords("conversation"),
          bookings: await persistentBookings.list("manabit"),
          tasks: await listRecords("task"),
          drafts: await listRecords("draft"),
          jobs: await listRecords("job"),
          metrics: await metrics(),
          channels: await channelStatus(),
          agents: agentRoles,
          google: agentConfigured(),
          ownerGoogle: agentConfigured("owner"),
          local: localAdmin(req),
        });
      if (path === "admin/settings" && method === "POST") {
        const value = z
          .object({
            from: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            to: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            duration: z.number().int().min(15).max(120).multipleOf(15),
            schedulingEnabled: z.boolean(),
            meetingUrl: z.union([z.literal(""), z.url()]),
            meetingNotes: z.string().trim().min(8).max(500),
          })
          .parse(await body(req));
        if (
          value.from >= value.to ||
          value.to > "23:59" ||
          value.from < "00:00"
        )
          throw new Error(
            "El horario de apertura debe ser anterior al cierre.",
          );
        if (value.meetingUrl && !value.meetingUrl.startsWith("https://"))
          throw new Error("El enlace de reunión debe usar https.");
        const p = await profile();
        p.business.hours = p.business.hours.map((h) => ({
          ...h,
          from: value.from,
          to: value.to,
        }));
        p.business.professionals = p.business.professionals.map((s) => ({
          ...s,
          hours: p.business.hours,
        }));
        p.business.services = p.business.services.map((s) => ({
          ...s,
          durationMinutes: value.duration,
        }));
        p.schedulingEnabled = value.schedulingEnabled;
        p.meetingUrl = value.meetingUrl;
        p.meetingNotes = value.meetingNotes;
        await saveProfile(p);
        return json({ ok: true });
      }
      if (path === "admin/simulate" && method === "POST") {
        const value = z
          .object({ channel, text: z.string().trim().min(1).max(4000) })
          .parse(await body(req));
        const c = await ensureConversation(
          `simulation:${randomUUID()}`,
          value.channel,
          `Prueba de ${value.channel}`,
          "simulation",
        );
        return json({
          conversation: await receiveMessage(c.id, value.text, randomUUID()),
        });
      }
      if (path === "admin/reply" && method === "POST") {
        const value = z
          .object({ id: z.string(), text: z.string().trim().min(1).max(4000) })
          .parse(await body(req));
        return await withConversationLock(value.id, async () => {
          const c = await handoff(value.id, "David tomó la conversación");
          const message = {
            id: randomUUID(),
            role: "owner" as const,
            author: "David Cevallos",
            text: value.text,
            at: new Date().toISOString(),
            delivery: "local" as "local" | "sent" | "failed",
          };
          let sendError: string | undefined;
          try {
            message.delivery = await sendOutgoing(c, message.text, message.id);
          } catch (e) {
            message.delivery = "failed";
            sendError =
              e instanceof Error ? e.message : "El canal no envió el mensaje.";
          }
          c.messages.push(message);
          c.updatedAt = message.at;
          await putRecord("conversation", c.id, c);
          return json({ ok: true, sendError });
        });
      }
      if (path === "admin/conversation" && method === "POST") {
        const value = z
          .object({
            id: z.string(),
            status: z.enum(["open", "human", "closed"]),
          })
          .parse(await body(req));
        return await withConversationLock(value.id, async () => {
          const c = await getRecord<Conversation>("conversation", value.id);
          if (!c) throw new Error("No existe esa conversación.");
          if (value.status === "human")
            await handoff(c.id, `Revisar ${c.name}`);
          else {
            c.status = value.status;
            await putRecord("conversation", c.id, c);
          }
          return json({ ok: true });
        });
      }
      if (path === "admin/cancel" && method === "POST") {
        const { id } = z.object({ id: z.string() }).parse(await body(req));
        await persistentBookings.cancel("manabit", id);
        return json({ ok: true });
      }
      if (path === "admin/task" && method === "POST") {
        const { id } = z.object({ id: z.string() }).parse(await body(req));
        const task = await getRecord<Task>("task", id);
        if (task) {
          task.status = "done";
          await putRecord("task", id, task);
        }
        return json({ ok: true });
      }
      if (path === "admin/run" && method === "POST") {
        const { kind } = z
          .object({ kind: z.enum(["summary", "ideas"]) })
          .parse(await body(req));
        const m = await metrics();
        let text =
          kind === "summary"
            ? `Hay ${m.conversations} conversaciones, ${m.waiting} pendientes de David y ${m.confirmed} diagnósticos confirmados. Tareas abiertas: ${m.tasks}. Pruebas locales incluidas: ${m.simulated}. Prioriza las conversaciones que esperan una persona y revisa las citas próximas.`
            : `Borrador para revisar: muestra cómo un negocio pasa de una consulta a una cita. Explica Tongabit con un recorrido de página, reserva y confirmación. Cierra invitando a un diagnóstico gratuito de 15 minutos. No publiques cifras de resultados sin un caso medido.`;
        let engine = "base local";
        if (agentConfigured("owner")) {
          const result = await askGoogle({
            audience: "owner",
            user: "manabit:owner:david",
            message:
              kind === "summary"
                ? "Revisa los resultados y dame prioridades."
                : "Prepara una idea de contenido para Manabit y guarda el borrador.",
          });
          text = result.text;
          engine = "Google ADK";
        }
        const draft = {
          id: randomUUID(),
          kind,
          text,
          engine,
          at: new Date().toISOString(),
        };
        await putRecord("draft", draft.id, draft);
        return json({ draft });
      }
      if (path === "admin/calendar.ics")
        return calendar(await persistentBookings.list("manabit"));
      if (path === "admin/jobs" && method === "POST") {
        const jobs = await listRecords<Job>("job");
        for (const j of jobs.filter((j) => j.status === "failed")) {
          j.status = "pending";
          j.attempts = 0;
          await putRecord("job", j.id, j);
        }
        return json({ processed: await runJobs() });
      }
    }
    return json({ error: "Ruta no encontrada." }, 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(" · "),
        },
        400,
      );
    if (e instanceof BookingError)
      return json(
        { error: e.message, code: e.code },
        e.code === "SLOT_TAKEN" ? 409 : 400,
      );
    return json(
      {
        error:
          e instanceof Error ? e.message : "No se pudo completar la operación.",
      },
      400,
    );
  }
}

async function tools(req: NextRequest, path: string) {
  if (!["tools/customer", "tools/owner"].includes(path))
    return json({ error: "Herramienta no encontrada." }, 404);
  const audience = path === "tools/owner" ? "owner" : "customer";
  if (req.method !== "POST" || !toolAuthorized(req, audience))
    return json({ error: "Herramienta no autorizada." }, 401);
  const value = z
    .object({
      action: z.string(),
      userId: z.string().optional(),
      args: z.record(z.string(), z.unknown()).default({}),
    })
    .parse(await body(req));
  if (value.action === "knowledge") {
    const p = await profile();
    return json({
      business: "Manabit",
      owner: "David Cevallos",
      zone: "Portoviejo y Manta",
      plans,
      diagnostic: {
        free: true,
        durationMinutes: p.business.services[0]?.durationMinutes,
        hours: p.business.hours,
        timeZone: p.business.timeZone,
        schedulingEnabled: p.schedulingEnabled,
        modes: ["videollamada", "en el negocio del cliente"],
        meetingNotes: p.meetingNotes,
      },
      pricing: "Cotización después del diagnóstico.",
    });
  }
  if (audience === "owner") {
    if (value.action === "metrics") return json(await metrics());
    if (value.action === "draft") {
      const { text } = z
        .object({ text: z.string().min(10).max(8000) })
        .parse(value.args);
      const draft = {
        id: randomUUID(),
        text,
        engine: "Google ADK",
        kind: "ideas",
        at: new Date().toISOString(),
      };
      await putRecord("draft", draft.id, draft);
      return json({ id: draft.id, saved: true });
    }
  } else {
    const id = value.userId?.replace(/^manabit:/, "");
    const c = id
      ? await getRecord<Conversation>("conversation", id)
      : undefined;
    if (!c || value.userId !== `manabit:${c.id}`)
      return json(
        { error: "La sesión no corresponde a una conversación de Manabit." },
        403,
      );
    if (value.action === "availability") {
      const { date } = z.object({ date: z.string() }).parse(value.args);
      return json({
        date,
        timeZone: "America/Guayaquil",
        slots: await availableSlots(date),
      });
    }
    if (value.action === "proposal") {
      const args = bookingSchema
        .omit({ accepted: true, key: true })
        .parse(value.args);
      return json(await propose(c, args));
    }
    if (value.action === "handoff") {
      const { reason } = z
        .object({ reason: z.string().min(3).max(500) })
        .parse(value.args);
      await handoff(c.id, reason);
      return json({ assignedTo: "David Cevallos", automationPaused: true });
    }
  }
  return json({ error: "Acción no permitida para este rol." }, 403);
}
function calendar(
  bookings: Awaited<ReturnType<typeof persistentBookings.list>>,
) {
  const escape = (v: string) =>
    v
      .replace(/\\/g, "\\\\")
      .replace(/[\r\n]+/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  const date = (v: string) => v.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const rows = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Manabit//Sistema//ES",
    "CALSCALE:GREGORIAN",
    ...bookings
      .filter((b) => b.status !== "cancelled")
      .flatMap((b) => [
        "BEGIN:VEVENT",
        `UID:${b.id}@manabit`,
        `DTSTAMP:${date(new Date().toISOString())}`,
        `DTSTART:${date(b.startAt)}`,
        `DTEND:${date(b.endAt)}`,
        "SUMMARY:Diagnóstico con David · Manabit",
        `LOCATION:${escape(b.meeting?.location || "Por coordinar")}`,
        `DESCRIPTION:${escape("Diagnóstico gratuito. Para cambios contacta con Manabit.")}`,
        "END:VEVENT",
      ]),
    "END:VCALENDAR",
  ];
  return new Response(rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "attachment; filename=manabit-agenda.ics",
      "Cache-Control": "no-store",
    },
  });
}
