"use client";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { AdminState } from "@/types/app";
import type { Channel } from "@/core/types";
import type { Conversation } from "@/server/conversations";
import { Icon } from "./Icon";
import { ManabitLoader } from "./brand/ManabitLoader";
import { api, channelNames, dateLabel, localDate } from "./client";

type Tab = "hoy" | "mensajes" | "agenda" | "agentes" | "canales" | "ajustes";
const navigation: { id: Tab; label: string; icon: string }[] = [
  { id: "hoy", label: "Hoy", icon: "home" },
  { id: "mensajes", label: "Conversaciones", icon: "inbox" },
  { id: "agenda", label: "Agenda", icon: "calendar" },
  { id: "agentes", label: "Equipo de agentes", icon: "agents" },
  { id: "canales", label: "Canales", icon: "channels" },
  { id: "ajustes", label: "Configuración", icon: "settings" },
];
const states: Record<string, string> = {
  open: "Asistente activo",
  human: "Espera a David",
  closed: "Cerrada",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  pending_confirmation: "Pendiente",
};
const descriptions: Record<string, string> = {
  web: "Recibe consultas y reserva diagnósticos desde tu enlace de atención.",
  whatsapp:
    "Conecta el número empresarial cuando completes el alta de la API de Meta.",
  instagram:
    "Atiende mensajes de una cuenta profesional de Instagram autorizada.",
  messenger: "Recibe mensajes dirigidos a tu Página de Facebook.",
  telegram:
    "Bot opcional para probar atención o avisos. No reemplaza las otras redes.",
};

export function Dashboard() {
  const [state, setState] = useState<AdminState>();
  const [tab, setTab] = useState<Tab>("hoy");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [menu, setMenu] = useState(false);
  const [dark, setDark] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [date, setDate] = useState("");
  const [simulationChannel, setSimulationChannel] = useState<Channel>("web");
  const [cancelId, setCancelId] = useState("");
  const reload = useCallback(async () => {
    try {
      setState(await api<AdminState>("admin/state"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
    setDark(document.documentElement.dataset.theme === "dark");
    const timer = setInterval(() => {
      if (!document.hidden) void reload();
    }, 8000);
    return () => clearInterval(timer);
  }, [reload]);
  const go = (value: Tab) => {
    setTab(value);
    setMenu(false);
    setError("");
    setNotice("");
  };
  async function action<T>(
    path: string,
    data: unknown,
  ): Promise<T | undefined> {
    setBusy(path);
    setError("");
    setNotice("");
    try {
      const value = await api<T>(path, data);
      await reload();
      return value;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function theme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("manabit-system-theme", next ? "dark" : "light");
    } catch {}
  }
  const conversations = state?.conversations ?? [];
  const active = conversations.find((c) => c.id === selected);
  const upcoming =
    state?.bookings.filter(
      (b) => b.status !== "cancelled" && new Date(b.startAt) > new Date(),
    ) ?? [];
  function clientName(contact: string) {
    return (
      state?.contacts?.find((c) => c.id === contact)?.name ||
      conversations.find((c) => c.contact === contact)?.name ||
      "Contacto"
    );
  }
  const heading = (title: string, lead: string, right?: ReactNode) => (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      {right}
    </header>
  );
  const empty = (title: string, text: string, link = true) => (
    <div className="empty">
      <Icon name="inbox" size={28} />
      <h2>{title}</h2>
      <p>{text}</p>
      {link && (
        <a
          className="button primary"
          href="/reservar"
          target="_blank"
          rel="noopener noreferrer"
        >
          Probar el chat web <Icon name="external" size={16} />
        </a>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <div className="mobile-top">
        <button
          className="icon-button"
          aria-label="Abrir navegación"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Icon name="menu" />
        </button>
        <img
          className="logo-light"
          src="/brand/manabit-horizontal.svg"
          alt="Manabit"
          width={125}
        />
        <img
          className="logo-dark"
          src="/brand/manabit-horizontal-negativo.svg"
          alt="Manabit"
          width={125}
        />
        <span>Sistema</span>
      </div>
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <a href="/" className="brand">
          <img
            className="logo-light"
            src="/brand/manabit-horizontal.svg"
            alt="Manabit"
            width={153}
          />
          <img
            className="logo-dark"
            src="/brand/manabit-horizontal-negativo.svg"
            alt="Manabit"
            width={153}
          />
          <span>Sistema · Tu negocio, conectado.</span>
        </a>
        <div className="workspace">
          <span className="workspace-square">M</span>
          <div>
            <strong>Manabit</strong>
            <small>Estudio de software</small>
          </div>
          <span className="bit" />
        </div>
        <nav aria-label="Navegación principal">
          {navigation.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "selected" : ""}
              onClick={() => go(n.id)}
              aria-current={tab === n.id ? "page" : undefined}
            >
              <Icon name={n.icon} size={18} />
              <span>{n.label}</span>
              {n.id === "mensajes" && !!state?.metrics.waiting && (
                <b className="nav-count">{state.metrics.waiting}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a href="/reservar" target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={16} /> Abrir atención web
          </a>
          <button onClick={theme}>
            <Icon name={dark ? "sun" : "moon"} size={17} />
            {dark ? "Fondo vainilla" : "Fondo noche"}
          </button>
          <div className="owner">
            <span>DC</span>
            <div>
              <strong>David Cevallos</strong>
              <small>Fundador · Administrador</small>
            </div>
          </div>
          <small>by David Cevallos</small>
        </div>
      </aside>
      {menu && (
        <button
          className="nav-scrim"
          onClick={() => setMenu(false)}
          aria-label="Cerrar navegación"
        />
      )}
      <main className={`app-main ${tab === "mensajes" ? "inbox-main" : ""}`}>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button aria-label="Cerrar aviso" onClick={() => setError("")}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button aria-label="Cerrar aviso" onClick={() => setNotice("")}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {!state ? (
          <div className="loading">
            <ManabitLoader size={48} />
            <p>Cargando tu centro de operaciones…</p>
            <button className="button" onClick={() => void reload()}>
              Volver a intentar
            </button>
          </div>
        ) : (
          <>
            {tab === "hoy" && (
              <>
                {heading(
                  "Tu negocio, en orden.",
                  "Consultas, diagnósticos y próximos pasos en un mismo lugar.",
                  <a
                    className="button primary"
                    href="/reservar"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Probar recepción <Icon name="arrow" size={16} />
                  </a>,
                )}
                <div className="mode-note">
                  <span className="status-dot" />
                  <p>
                    <strong>
                      {state.google
                        ? "Google ADK configurado"
                        : "Recepción guiada disponible"}
                    </strong>
                    <span>
                      {state.google
                        ? "Las respuestas se solicitan a tu agente de Google."
                        : "Prueba el recorrido web mientras preparas los agentes en Google Cloud."}
                    </span>
                  </p>
                  <button onClick={() => go("agentes")}>
                    Ver equipo <Icon name="arrow" size={16} />
                  </button>
                </div>
                <div className="stats">
                  <div>
                    <span>Conversaciones</span>
                    <strong>{state.metrics.conversations}</strong>
                    <small>
                      {state.metrics.simulated
                        ? `${state.metrics.simulated} de prueba`
                        : "Tu bandeja comienza aquí"}
                    </small>
                  </div>
                  <div>
                    <span>Esperan a David</span>
                    <strong
                      className={state.metrics.waiting ? "accent-text" : ""}
                    >
                      {state.metrics.waiting}
                    </strong>
                    <small>Atención humana pendiente</small>
                  </div>
                  <div>
                    <span>Diagnósticos confirmados</span>
                    <strong>{state.metrics.confirmed}</strong>
                    <small>Acumulado de la agenda</small>
                  </div>
                </div>
                <div className="home-grid">
                  <section className="panel">
                    <div className="panel-title">
                      <h2>Lo próximo en tu agenda</h2>
                      <button onClick={() => go("agenda")}>
                        Ver agenda <Icon name="arrow" size={16} />
                      </button>
                    </div>
                    {upcoming.length ? (
                      <div className="compact-list">
                        {upcoming.slice(0, 4).map((b) => (
                          <div key={b.id}>
                            <div>
                              <strong>{clientName(b.customerRef)}</strong>
                              <p>
                                {b.meeting?.mode} · {b.meeting?.location}
                              </p>
                            </div>
                            <time>{dateLabel(b.startAt)}</time>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="agenda-empty">
                        <div className="timeline-sample" aria-hidden>
                          <span>09:00</span>
                          <i />
                          <span>09:15</span>
                          <i />
                          <span>09:30</span>
                        </div>
                        <h3>Espacio para tu próximo diagnóstico.</h3>
                        <p>
                          De lunes a viernes,{" "}
                          {state.profile.business.hours[0]?.from}–
                          {state.profile.business.hours[0]?.to}. El cliente
                          elige videollamada o visita a su negocio.
                        </p>
                        <a
                          href="/reservar"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Abrir el recorrido de reserva{" "}
                          <Icon name="arrow" size={16} />
                        </a>
                      </div>
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-title">
                      <h2>Conexiones de Manabit</h2>
                      <button onClick={() => go("canales")}>Revisar</button>
                    </div>
                    <div className="connection-list">
                      {state.channels.map((c) => (
                        <div key={c.id}>
                          <span className={`channel-mark ${c.id}`}>
                            {(channelNames[c.id] ?? c.id).slice(0, 1)}
                          </span>
                          <span>{channelNames[c.id]}</span>
                          <span
                            className={`badge ${c.status === "active" ? "good" : ""}`}
                          >
                            {c.status === "active"
                              ? "Disponible"
                              : c.status === "receiving"
                                ? "Recibe eventos"
                                : c.status === "configured"
                                  ? "Por verificar"
                                  : "Sin conectar"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="panel-foot">
                      Empieza por web. Activa cada red cuando hayas completado
                      su autorización.
                    </p>
                  </section>
                </div>
                <section className="tasks-section">
                  <div className="section-title">
                    <h2>Para David</h2>
                    <span>{state.metrics.tasks} tareas abiertas</span>
                  </div>
                  {state.tasks.filter((t) => t.status === "open").length ? (
                    state.tasks
                      .filter((t) => t.status === "open")
                      .map((t) => (
                        <div className="task-row" key={t.id}>
                          <div>
                            <strong>{t.title}</strong>
                            <small>{dateLabel(t.at)}</small>
                          </div>
                          <button
                            className="button"
                            onClick={() =>
                              void action("admin/task", { id: t.id })
                            }
                          >
                            Marcar resuelta
                          </button>
                        </div>
                      ))
                  ) : (
                    <p className="quiet-empty">
                      Cuando una consulta necesite tu criterio, aparecerá aquí.
                    </p>
                  )}
                </section>
              </>
            )}
            {tab === "mensajes" && (
              <>
                {heading(
                  "Conversaciones",
                  "El contexto de cada consulta, desde el primer mensaje hasta el diagnóstico.",
                )}
                <div
                  className={`inbox-layout ${active ? "has-selection" : ""}`}
                >
                  <section className="conversation-list">
                    <div className="list-tools">
                      <label className="sr-only" htmlFor="search">
                        Buscar conversaciones
                      </label>
                      <input
                        id="search"
                        placeholder="Buscar por nombre o mensaje"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <label className="sr-only" htmlFor="channel-filter">
                        Filtrar canal
                      </label>
                      <select
                        id="channel-filter"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">Todos los canales</option>
                        {Object.entries(channelNames).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {conversations
                      .filter(
                        (c) =>
                          (filter === "all" || c.channel === filter) &&
                          `${c.name} ${c.messages.at(-1)?.text}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((c) => (
                        <button
                          className={`conversation-row ${active?.id === c.id ? "active" : ""}`}
                          key={c.id}
                          onClick={() => setSelected(c.id)}
                        >
                          <div className="row-top">
                            <strong>{c.name}</strong>
                            <time>{dateLabel(c.updatedAt, true)}</time>
                          </div>
                          <p>{c.messages.at(-1)?.text}</p>
                          <div className="row-bottom">
                            <span>
                              {channelNames[c.channel]}
                              {c.mode === "simulation" ? " · Prueba" : ""}
                            </span>
                            <span
                              className={
                                c.status === "human" ? "accent-text" : ""
                              }
                            >
                              {states[c.status]}
                            </span>
                          </div>
                        </button>
                      ))}
                    {!conversations.length && (
                      <p className="list-empty">
                        Las consultas aparecerán aquí. Abre el chat web para
                        enviar la primera.
                      </p>
                    )}
                  </section>
                  <section className="conversation-detail">
                    {active ? (
                      <>
                        <div className="conversation-head">
                          <button
                            className="icon-button back-list"
                            onClick={() => setSelected(undefined)}
                            aria-label="Volver a conversaciones"
                          >
                            <Icon name="back" />
                          </button>
                          <div>
                            <h2>{active.name}</h2>
                            <p>
                              {channelNames[active.channel]} ·{" "}
                              {active.mode === "simulation"
                                ? "Simulación: no envía mensajes a redes"
                                : states[active.status]}
                            </p>
                          </div>
                          <select
                            aria-label="Estado de conversación"
                            value={active.status}
                            onChange={(e) =>
                              void action("admin/conversation", {
                                id: active.id,
                                status: e.target.value,
                              })
                            }
                          >
                            <option value="open">Asistente activo</option>
                            <option value="human">Tomar conversación</option>
                            <option value="closed">Cerrar conversación</option>
                          </select>
                        </div>
                        <div className="messages">
                          {active.messages.map((m) => (
                            <div className={`message ${m.role}`} key={m.id}>
                              <div className="message-author">
                                {m.role === "customer"
                                  ? active.name
                                  : m.role === "owner"
                                    ? "David"
                                    : m.author.replace("manabit_", "")}
                                <time>{dateLabel(m.at, true)}</time>
                              </div>
                              <p>{m.text}</p>
                              {m.role !== "customer" && (
                                <small>
                                  {m.delivery === "failed"
                                    ? "No se envió al canal"
                                    : m.delivery === "sent"
                                      ? "Enviado al canal"
                                      : active.mode === "simulation"
                                        ? "Respuesta de prueba"
                                        : "Guardado en el chat"}
                                </small>
                              )}
                            </div>
                          ))}
                        </div>
                        <form
                          className="reply-form"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const form = e.currentTarget;
                            const data = new FormData(form);
                            const r = await action<{ sendError?: string }>(
                              "admin/reply",
                              { id: active.id, text: data.get("reply") },
                            );
                            if (r) {
                              form.reset();
                              if (r.sendError) setError(r.sendError);
                            }
                          }}
                        >
                          <label htmlFor="reply">Responder como David</label>
                          <textarea
                            id="reply"
                            name="reply"
                            rows={2}
                            required
                            maxLength={4000}
                            placeholder="Escribe una respuesta…"
                            disabled={active.status === "closed"}
                          />
                          <div>
                            <small>
                              Responder pausa al asistente en esta conversación.
                            </small>
                            <button
                              className="button primary"
                              disabled={!!busy || active.status === "closed"}
                            >
                              <Icon name="send" size={16} />
                              Responder
                            </button>
                          </div>
                        </form>
                      </>
                    ) : (
                      empty(
                        "Cada conversación, con contexto.",
                        "Elige una consulta para ver el historial, responder o dejar que la recepción continúe.",
                      )
                    )}
                  </section>
                </div>
              </>
            )}
            {tab === "agenda" && (
              <>
                {heading(
                  "Agenda de diagnósticos",
                  "Fecha, modalidad y lugar. Una misma disponibilidad para todos los canales.",
                  <a className="button" href="/api/admin/calendar.ics">
                    Descargar calendario
                  </a>,
                )}
                <div className="agenda-toolbar">
                  <label>
                    Filtrar por día
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  {date && (
                    <button onClick={() => setDate("")}>Mostrar todas</button>
                  )}
                  <a
                    className="button primary"
                    href="/reservar"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="plus" size={16} />
                    Reservar diagnóstico
                  </a>
                </div>
                <div className="booking-list">
                  {state.bookings
                    .filter(
                      (b) => !date || localDate(new Date(b.startAt)) === date,
                    )
                    .map((b) => (
                      <article
                        key={b.id}
                        className={`booking-row ${b.status === "cancelled" ? "cancelled" : ""}`}
                      >
                        <div className="booking-time">
                          <strong>{dateLabel(b.startAt, true)}</strong>
                          <small>
                            {new Intl.DateTimeFormat("es-EC", {
                              timeZone: "America/Guayaquil",
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            }).format(new Date(b.startAt))}
                          </small>
                        </div>
                        <div>
                          <h2>{clientName(b.customerRef)}</h2>
                          <p>
                            Diagnóstico gratuito ·{" "}
                            {Math.round(
                              (new Date(b.endAt).getTime() -
                                new Date(b.startAt).getTime()) /
                                60000,
                            )}{" "}
                            min · {b.meeting?.mode || "Por coordinar"}
                          </p>
                          <p className="booking-place">{b.meeting?.location}</p>
                        </div>
                        <div className="booking-actions">
                          <span className="badge">{states[b.status]}</span>
                          {b.status !== "cancelled" &&
                            (cancelId === b.id ? (
                              <>
                                <button
                                  className="danger-button"
                                  onClick={async () => {
                                    await action("admin/cancel", { id: b.id });
                                    setCancelId("");
                                  }}
                                >
                                  Confirmar cancelación
                                </button>
                                <button onClick={() => setCancelId("")}>
                                  Volver
                                </button>
                              </>
                            ) : (
                              <button onClick={() => setCancelId(b.id)}>
                                Cancelar cita
                              </button>
                            ))}
                        </div>
                      </article>
                    ))}
                </div>
                {!state.bookings.length &&
                  empty(
                    "Aún no hay diagnósticos.",
                    "Prueba una reserva desde el chat web. La cita quedará aquí y podrás descargarla como evento de calendario.",
                  )}
                <p className="footnote">
                  Zona horaria: Ecuador continental (UTC−5). La descarga .ics
                  permite añadir citas a tu calendario; la sincronización
                  automática con Google Calendar aún no está conectada.
                </p>
              </>
            )}
            {tab === "agentes" && (
              <>
                {heading(
                  "Tu equipo, detrás de Manabit.",
                  "Una recepción para tus clientes. Herramientas y permisos distintos para cada tarea.",
                )}
                <div className="agent-architecture">
                  <div className="root-node">
                    <img src="/brand/manabit-emblema.svg" width={34} alt="" />
                    <div>
                      <strong>manabit_recepcion</strong>
                      <span>Recibe · entiende · dirige</span>
                    </div>
                    <span className="badge">
                      {state.google ? "Google configurado" : "Modo guiado"}
                    </span>
                  </div>
                  <div className="architecture-line" aria-hidden />
                  <div className="specialist-strip">
                    {state.agents
                      .filter(
                        (a) =>
                          a.audience === "clientes" &&
                          a.id !== "manabit_recepcion",
                      )
                      .map((a) => (
                        <div key={a.id}>
                          <strong>{a.name}</strong>
                          <small>{a.id}</small>
                        </div>
                      ))}
                  </div>
                </div>
                <section className="agent-list">
                  {state.agents.map((a) => (
                    <article key={a.id}>
                      <div>
                        <h2>{a.name}</h2>
                        <code>{a.id}</code>
                        <p>{a.description}</p>
                      </div>
                      <div>
                        <span className="badge">
                          {a.audience === "David"
                            ? "Solo David"
                            : "Atención al cliente"}
                        </span>
                        <small>{a.tools.join(" · ")}</small>
                      </div>
                    </article>
                  ))}
                </section>
                <div className="section-title">
                  <div>
                    <h2>Trabajo interno</h2>
                    <p>
                      {state.ownerGoogle
                        ? "Conectado al agente interno de Google."
                        : "Las acciones locales usan tus datos y textos base; todavía no llaman a Gemini."}
                    </p>
                  </div>
                  <div className="button-row">
                    <button
                      className="button"
                      disabled={!!busy}
                      onClick={() =>
                        void action("admin/run", { kind: "summary" })
                      }
                    >
                      Preparar resumen
                    </button>
                    <button
                      className="button primary"
                      disabled={!!busy}
                      onClick={() =>
                        void action("admin/run", { kind: "ideas" })
                      }
                    >
                      Preparar idea
                    </button>
                  </div>
                </div>
                <div className="draft-list">
                  {state.drafts.map((d) => (
                    <article key={d.id}>
                      <div>
                        <strong>
                          {d.kind === "summary"
                            ? "Resumen de operación"
                            : "Borrador de contenido"}
                        </strong>
                        <span>
                          {d.engine} · {dateLabel(d.at)}
                        </span>
                      </div>
                      <p>{d.text}</p>
                      <small>
                        Borrador interno. No se publica ni se envía
                        automáticamente.
                      </small>
                    </article>
                  ))}
                </div>
                <a
                  className="text-link"
                  href="/guias/google-cloud.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Guía para crear y desplegar los agentes{" "}
                  <Icon name="external" size={16} />
                </a>
              </>
            )}
            {tab === "canales" && (
              <>
                {heading(
                  "Conecta a tu ritmo.",
                  "Aprende el recorrido en web y habilita una red a la vez. Cada estado refleja la configuración real.",
                )}
                <div className="channel-cards">
                  {state.channels.map((c) => (
                    <article key={c.id}>
                      <div className="channel-card-heading">
                        <span className={`channel-mark ${c.id}`}>
                          {(channelNames[c.id] ?? c.id).slice(0, 1)}
                        </span>
                        <h2>{channelNames[c.id]}</h2>
                        <span
                          className={`badge ${c.status === "active" ? "good" : ""}`}
                        >
                          {c.status === "active"
                            ? "Disponible"
                            : c.status === "receiving"
                              ? "Eventos recibidos"
                              : c.status === "configured"
                                ? "Credenciales listas"
                                : "Sin conectar"}
                        </span>
                      </div>
                      <p>{descriptions[c.id]}</p>
                      <small>
                        {c.status === "active"
                          ? "El chat y la reserva ya guardan datos en tu sistema."
                          : c.status === "receiving"
                            ? `Último evento: ${dateLabel(c.lastEventAt!)}`
                            : "Completa la autorización y verifica el webhook antes de usarlo con clientes."}
                      </small>
                      {c.id === "web" ? (
                        <a
                          href="/reservar"
                          className="text-link"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Abrir chat web <Icon name="external" size={16} />
                        </a>
                      ) : (
                        <button
                          className="text-link"
                          onClick={() => {
                            setSimulationChannel(c.id);
                            document.getElementById("sim-text")?.focus();
                          }}
                        >
                          Probar recepción local <Icon name="arrow" size={16} />
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                <section className="simulation-panel">
                  <h2>Un mensaje, desde cualquier canal.</h2>
                  <p>
                    Esta prueba guarda una conversación marcada como simulación.
                    No conecta la red ni envía mensajes fuera de este sistema.
                  </p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      const result = await action<{
                        conversation: Conversation;
                      }>("admin/simulate", {
                        channel: simulationChannel,
                        text: data.get("text"),
                      });
                      if (result) {
                        setSelected(result.conversation.id);
                        go("mensajes");
                      }
                    }}
                  >
                    <label>
                      Canal de prueba
                      <select
                        value={simulationChannel}
                        onChange={(e) =>
                          setSimulationChannel(e.target.value as Channel)
                        }
                      >
                        {Object.entries(channelNames).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Mensaje del cliente
                      <textarea
                        id="sim-text"
                        name="text"
                        rows={2}
                        defaultValue="Hola, tengo un negocio y quiero saber qué incluye Tongabit."
                        required
                        maxLength={4000}
                      />
                    </label>
                    <button className="button primary" disabled={!!busy}>
                      {busy ? "Procesando…" : "Enviar prueba local"}
                      <Icon name="arrow" size={16} />
                    </button>
                  </form>
                </section>
                <p className="footnote">
                  Marketplace personal requiere revisar el acceso disponible
                  para cada cuenta; no se presenta como una integración
                  automática.{" "}
                  <a
                    href="/guias/canales.md"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Leer guía de canales
                  </a>
                  .
                </p>
                {!!state.jobs.filter((j) => j.status === "failed").length && (
                  <div className="notice error">
                    <p>
                      Hay{" "}
                      {state.jobs.filter((j) => j.status === "failed").length}{" "}
                      eventos con fallos. Revisa el canal antes de reintentar.
                    </p>
                    <button onClick={() => void action("admin/jobs", {})}>
                      Reintentar eventos
                    </button>
                  </div>
                )}
              </>
            )}
            {tab === "ajustes" && (
              <>
                {heading(
                  "Las reglas de tu agenda.",
                  "Horario confirmado por David. Los cambios se aplican a las reservas nuevas.",
                )}
                <form
                  className="settings-form"
                  onSubmit={async (e: FormEvent<HTMLFormElement>) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    const result = await action("admin/settings", {
                      from: data.get("from"),
                      to: data.get("to"),
                      duration: Number(data.get("duration")),
                      schedulingEnabled: data.get("enabled") === "on",
                      meetingUrl: data.get("meetingUrl"),
                      meetingNotes: data.get("meetingNotes"),
                    });
                    if (result)
                      setNotice(
                        "Configuración guardada. La agenda pública ya usa estas reglas.",
                      );
                  }}
                >
                  <section>
                    <div>
                      <h2>Disponibilidad</h2>
                      <p>
                        Lunes a viernes, hora de Ecuador. Las citas existentes
                        mantienen su fecha y duración.
                      </p>
                    </div>
                    <div className="settings-fields">
                      <div className="form-grid">
                        <label>
                          Desde
                          <input
                            type="time"
                            name="from"
                            required
                            defaultValue={state.profile.business.hours[0]?.from}
                          />
                        </label>
                        <label>
                          Hasta
                          <input
                            type="time"
                            name="to"
                            required
                            defaultValue={state.profile.business.hours[0]?.to}
                          />
                        </label>
                      </div>
                      <label>
                        Duración del diagnóstico
                        <select
                          name="duration"
                          defaultValue={
                            state.profile.business.services[0]?.durationMinutes
                          }
                        >
                          <option value="15">15 minutos</option>
                          <option value="30">30 minutos</option>
                          <option value="45">45 minutos</option>
                          <option value="60">60 minutos</option>
                        </select>
                      </label>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          name="enabled"
                          defaultChecked={state.profile.schedulingEnabled}
                        />
                        Aceptar nuevas reservas web
                      </label>
                    </div>
                  </section>
                  <section>
                    <div>
                      <h2>Cuándo y dónde</h2>
                      <p>
                        Las reuniones presenciales piden la dirección del
                        cliente. Puedes añadir un enlace fijo para
                        videollamadas.
                      </p>
                    </div>
                    <div className="settings-fields">
                      <label>
                        Enlace de videollamada (opcional)
                        <input
                          type="url"
                          name="meetingUrl"
                          placeholder="https://meet.google.com/…"
                          defaultValue={state.profile.meetingUrl}
                        />
                      </label>
                      <label>
                        Instrucción para videollamadas
                        <textarea
                          name="meetingNotes"
                          required
                          rows={3}
                          defaultValue={state.profile.meetingNotes}
                          maxLength={500}
                        />
                      </label>
                    </div>
                  </section>
                  <section>
                    <div>
                      <h2>Datos de Manabit</h2>
                      <p>Información utilizada para atender tus consultas.</p>
                    </div>
                    <dl className="settings-details">
                      <dt>Responsable</dt>
                      <dd>David Cevallos</dd>
                      <dt>WhatsApp</dt>
                      <dd>+593 97 910 7716</dd>
                      <dt>Correo</dt>
                      <dd>{state.profile.email}</dd>
                      <dt>Zona</dt>
                      <dd>Portoviejo y Manta</dd>
                    </dl>
                  </section>
                  <div className="settings-submit">
                    <button className="button primary" disabled={!!busy}>
                      {busy ? "Guardando…" : "Guardar configuración"}
                      <Icon name="check" size={16} />
                    </button>
                  </div>
                </form>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
