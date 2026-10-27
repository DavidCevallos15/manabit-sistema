"use client";
import { useEffect, useRef, useState } from "react";
import type { Conversation } from "@/server/conversations";
import type { Booking } from "@/core/types";
import { api, dateLabel, localDate } from "./client";
import { Icon } from "./Icon";
import { ManabitLoader } from "./brand/ManabitLoader";

export function PublicReception() {
  const [conversation, setConversation] = useState<Conversation>();
  const [view, setView] = useState<"chat" | "booking">("chat");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [date, setDate] = useState(localDate());
  const [slots, setSlots] = useState<{ startAt: string; label: string }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"videollamada" | "presencial">(
    "videollamada",
  );
  const [booking, setBooking] = useState<Booking>();
  const [hours, setHours] = useState({ from: "09:00", to: "17:00" });
  const [duration, setDuration] = useState(15);
  const [meetingNotes, setMeetingNotes] = useState(
    "David compartirá el enlace antes de la cita.",
  );
  const [enabled, setEnabled] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const requestKey = useRef("");
  useEffect(() => {
    void api<{ conversation: Conversation }>("public/session", {})
      .then((r) => setConversation(r.conversation))
      .catch((e) => setError(e.message));
    void api<{
      duration: number;
      hours: { from: string; to: string };
      meetingNotes: string;
      schedulingEnabled: boolean;
    }>("public/config")
      .then((r) => {
        setDuration(r.duration);
        setHours(r.hours);
        setMeetingNotes(r.meetingNotes);
        setEnabled(r.schedulingEnabled);
      })
      .catch(() => {});
    const timer = setInterval(() => {
      if (!document.hidden)
        void api<{ conversation: Conversation }>("public/conversation")
          .then((r) => setConversation(r.conversation))
          .catch(() => {});
    }, 6000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (view !== "booking") return;
    let alive = true;
    setLoadingSlots(true);
    setSelected("");
    void api<{ slots: typeof slots }>(`public/slots?date=${date}`)
      .then((r) => {
        if (alive) setSlots(r.slots);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoadingSlots(false);
      });
    return () => {
      alive = false;
    };
  }, [date, view]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "instant" });
  }, [conversation?.messages.length, busy]);
  async function send(text: string) {
    if (!text.trim() || busy || conversation?.status === "closed") return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ conversation: Conversation }>("public/message", {
        text,
        event: crypto.randomUUID(),
      });
      setConversation(r.conversation);
      setInput("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public-shell">
      <aside className="public-aside">
        <a href="https://manabit-three.vercel.app/" className="public-brand">
          <img
            src="/brand/manabit-horizontal-negativo.svg"
            width={175}
            alt="Manabit"
          />
        </a>
        <div>
          <h1>Hablemos de tu negocio.</h1>
          <p>
            Una página, una agenda y una forma de atender mejor. Empezamos
            viendo lo que necesitas.
          </p>
          <div className="public-person">
            <span>DC</span>
            <div>
              <strong>David Cevallos</strong>
              <small>Fundador de Manabit</small>
            </div>
          </div>
        </div>
        <div className="public-details">
          <p>
            <Icon name="clock" size={18} />
            Diagnóstico gratis · {duration} minutos
          </p>
          <p>
            <Icon name="calendar" size={18} />
            Lunes a viernes · {hours.from}–{hours.to}
          </p>
          <p>
            Videollamada o en tu negocio
            <br />
            Portoviejo y Manta · Hora de Ecuador
          </p>
          <small>by David Cevallos</small>
        </div>
      </aside>
      <section className="public-panel">
        <header className="public-header">
          <div>
            <strong>
              {view === "chat"
                ? "Recepción de Manabit"
                : booking
                  ? "Tu diagnóstico está reservado"
                  : "Elige cuándo nos vemos"}
            </strong>
            <small>
              {view === "chat"
                ? "Planes, dudas y diagnósticos"
                : "Disponibilidad real de la agenda"}
            </small>
          </div>
          <button
            className="button"
            onClick={() => {
              setView(view === "chat" ? "booking" : "chat");
              setError("");
            }}
          >
            {view === "chat" ? (
              <>
                <Icon name="calendar" size={16} />
                Elegir horario
              </>
            ) : (
              <>
                <Icon name="back" size={16} />
                Volver al chat
              </>
            )}
          </button>
        </header>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Cerrar aviso">
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {view === "chat" ? (
          <>
            <div className="public-messages">
              {!conversation ? (
                <div className="loading">
                  <ManabitLoader size={42} />
                  <p>Abriendo tu conversación…</p>
                </div>
              ) : (
                conversation.messages.map((m) => (
                  <div key={m.id} className={`message ${m.role}`}>
                    <div className="message-author">
                      {m.role === "customer"
                        ? "Tú"
                        : m.role === "owner"
                          ? "David Cevallos"
                          : "Asistente de Manabit"}
                      <time>{dateLabel(m.at, true)}</time>
                    </div>
                    <p>{m.text}</p>
                  </div>
                ))
              )}
              {busy && (
                <div role="status" className="typing">
                  <ManabitLoader size={22} />
                  <span>Preparando respuesta…</span>
                </div>
              )}
              <div ref={end} />
            </div>
            <div className="public-composer">
              <div className="quick-actions">
                <button
                  disabled={
                    busy || !conversation || conversation.status === "closed"
                  }
                  onClick={() =>
                    void send("Quiero conocer los planes de Manabit")
                  }
                >
                  Ver planes
                </button>
                <button onClick={() => setView("booking")}>
                  Agendar diagnóstico
                </button>
                <button
                  disabled={
                    busy || !conversation || conversation.status === "closed"
                  }
                  onClick={() => void send("Quiero hablar con David")}
                >
                  Hablar con David
                </button>
              </div>
              {conversation?.status === "closed" && (
                <p className="human-note">
                  Esta conversación está cerrada. David puede reabrirla desde su
                  panel.
                </p>
              )}
              {conversation?.status === "human" && (
                <p className="human-note">
                  David tiene tu consulta pendiente. Puedes seguir escribiendo;
                  el asistente está pausado.
                </p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
              >
                <label className="sr-only" htmlFor="public-message">
                  Tu mensaje
                </label>
                <textarea
                  id="public-message"
                  rows={2}
                  maxLength={4000}
                  placeholder="Cuéntanos qué necesita tu negocio…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={!conversation || conversation.status === "closed"}
                />
                <button
                  type="submit"
                  className="icon-button send-button"
                  aria-label="Enviar mensaje"
                  disabled={
                    !input.trim() ||
                    busy ||
                    !conversation ||
                    conversation.status === "closed"
                  }
                >
                  <Icon name="send" />
                </button>
              </form>
              <small>
                El asistente puede ayudarte con información y reservas. David
                revisa las consultas que requieren atención personal.
              </small>
            </div>
          </>
        ) : booking ? (
          <div className="booking-success">
            <span className="success-mark">
              <Icon name="check" size={28} />
            </span>
            <h2>Ya tenemos una cita.</h2>
            <p>Diagnóstico gratuito con David Cevallos.</p>
            <dl>
              <dt>Cuándo</dt>
              <dd>{dateLabel(booking.startAt)} · Hora de Ecuador</dd>
              <dt>Modalidad</dt>
              <dd>{booking.meeting?.mode}</dd>
              <dt>Dónde</dt>
              <dd>{booking.meeting?.location}</dd>
              <dt>Referencia</dt>
              <dd>{booking.id.slice(0, 8)}</dd>
            </dl>
            <a
              className="button primary"
              href={`/api/public/booking.ics?id=${booking.id}`}
            >
              <Icon name="calendar" size={16} />
              Añadir a mi calendario
            </a>
            <button className="text-link" onClick={() => setView("chat")}>
              Volver a la conversación <Icon name="arrow" size={16} />
            </button>
          </div>
        ) : (
          <form
            className="public-booking"
            onChange={() => {
              requestKey.current = "";
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              setBusy(true);
              const data = new FormData(e.currentTarget);
              requestKey.current ||= crypto.randomUUID();
              try {
                const r = await api<{ booking: Booking }>("public/book", {
                  startAt: selected,
                  mode,
                  address:
                    mode === "presencial" ? data.get("address") : undefined,
                  accepted: data.get("accepted") === "on",
                  name: data.get("name"),
                  contactDetail: data.get("contactDetail"),
                  key: requestKey.current,
                });
                setBooking(r.booking);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="booking-intro">
              <h2>Un espacio para escucharte.</h2>
              <p>
                {duration} minutos para revisar tu atención actual y ver qué
                sistema encaja con tu negocio. Sin costo.
              </p>
            </div>
            {!enabled && (
              <p className="notice">
                La agenda está pausada. Puedes dejar una consulta en el chat
                para coordinar con David.
              </p>
            )}
            <div className="form-grid">
              <label>
                Fecha
                <input
                  type="date"
                  value={date}
                  min={localDate()}
                  max={localDate(new Date(Date.now() + 90 * 86400_000))}
                  required
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Cómo nos reunimos
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="videollamada">Videollamada</option>
                  <option value="presencial">En mi negocio</option>
                </select>
              </label>
            </div>
            <fieldset className="slot-fieldset">
              <legend>Horarios disponibles · Ecuador</legend>
              {loadingSlots ? (
                <p role="status">Consultando la agenda…</p>
              ) : slots.length ? (
                <div className="slots">
                  {slots.map((s) => (
                    <button
                      key={s.startAt}
                      type="button"
                      aria-pressed={selected === s.startAt}
                      className={selected === s.startAt ? "selected" : ""}
                      onClick={() => {
                        setSelected(s.startAt);
                        requestKey.current = "";
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="slot-empty">
                  No hay horarios disponibles este día. Elige otra fecha de
                  lunes a viernes.
                </p>
              )}
            </fieldset>
            <div className="form-grid">
              <label>
                Tu nombre
                <input
                  name="name"
                  autoComplete="name"
                  minLength={2}
                  maxLength={100}
                  required
                />
              </label>
              <label>
                Correo o WhatsApp
                <input
                  name="contactDetail"
                  autoComplete="email"
                  minLength={5}
                  maxLength={150}
                  required
                  placeholder="Para que David te contacte"
                />
              </label>
            </div>
            {mode === "presencial" ? (
              <label>
                Nombre del negocio y dirección
                <textarea
                  name="address"
                  rows={2}
                  minLength={8}
                  maxLength={300}
                  required
                  placeholder="Nombre, calle, referencia y ciudad"
                />
              </label>
            ) : (
              <p className="meeting-note">
                <Icon name="calendar" size={18} />
                {meetingNotes}
              </p>
            )}
            {selected && (
              <div className="booking-summary">
                <strong>Tu diagnóstico: {dateLabel(selected)}</strong>
                <span>
                  {duration} minutos ·{" "}
                  {mode === "presencial"
                    ? "Visita a tu negocio"
                    : "Videollamada"}{" "}
                  · Sin costo
                </span>
              </div>
            )}
            <label className="check-label">
              <input type="checkbox" name="accepted" required />
              Acepto la fecha y modalidad elegidas y que Manabit use estos datos
              para gestionar mi diagnóstico.
            </label>
            <button
              type="submit"
              className="button primary full-width"
              disabled={!selected || busy || !conversation || !enabled}
            >
              {busy
                ? "Guardando tu diagnóstico…"
                : "Confirmar diagnóstico gratuito"}
              <Icon name="arrow" size={17} />
            </button>
            <small className="booking-privacy">
              Usamos tus datos para atender esta consulta y coordinar la cita.
              Para cambios o eliminación, escribe a jimdav1506ceva@gmail.com.
              Esta reserva no activa campañas promocionales.
            </small>
          </form>
        )}
      </section>
    </main>
  );
}
