import { GoogleAuth } from "google-auth-library";

export function agentConfigured(audience = "customer") {
  return !!(audience === "owner"
    ? process.env.GOOGLE_OWNER_AGENT_ENGINE_ID
    : process.env.GOOGLE_AGENT_ENGINE_ID);
}
function config(audience: string) {
  const resource =
    (audience === "owner"
      ? process.env.GOOGLE_OWNER_AGENT_ENGINE_ID
      : process.env.GOOGLE_AGENT_ENGINE_ID) || "";
  const match = resource.match(
    /^projects\/([^/]+)\/locations\/([^/]+)\/reasoningEngines\/([^/]+)$/,
  );
  if (!match)
    throw new Error(
      "El recurso de Google Agent Runtime no tiene un formato válido.",
    );
  return { resource, location: match[2] };
}
async function query(
  resource: string,
  location: string | undefined,
  payload: object,
  stream = false,
) {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("No hay credenciales ADC de Google.");
  const response = await fetch(
    `https://${location}-aiplatform.googleapis.com/v1/${resource}:${stream ? "streamQuery?alt=sse" : "query"}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Google no respondió correctamente (${response.status}). La conversación queda disponible para David.`,
    );
  return response;
}
export async function askGoogle(input: {
  user: string;
  message: string;
  session?: string;
  audience?: string;
}) {
  const audience = input.audience || "customer";
  const { resource, location } = config(audience);
  let session = input.session;
  if (!session) {
    const response = await query(resource, location, {
      class_method:
        process.env.GOOGLE_AGENT_SESSION_METHOD || "async_create_session",
      input: { user_id: input.user },
    });
    const data = await response.json();
    session = data.output?.id || data.output?.session_id || data.id;
    if (!session)
      throw new Error(
        "El agente no devolvió una sesión. Revisa su contrato de despliegue.",
      );
  }
  const response = await query(
    resource,
    location,
    {
      class_method: "async_stream_query",
      input: {
        user_id: input.user,
        session_id: session,
        message: input.message,
        run_config: { max_llm_calls: 8 },
      },
    },
    true,
  );
  const raw = await response.text();
  const texts: string[] = [];
  // Framing SSE o valores JSON consecutivos: separa por balance sin ejecutar el contenido.
  let depth = 0,
    quoted = false,
    escaped = false,
    begin = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"' && depth) {
      quoted = true;
      continue;
    }
    if (c === "{" || c === "[") {
      if (!depth) begin = i;
      depth++;
    }
    if (c === "}" || c === "]") {
      depth--;
      if (!depth && begin >= 0) {
        try {
          const data = JSON.parse(raw.slice(begin, i + 1));
          for (const event of Array.isArray(data) ? data : [data]) {
            if (event.partial === true) continue;
            for (const part of event.content?.parts || [])
              if (typeof part.text === "string" && !part.thought)
                texts.push(part.text);
          }
        } catch {}
        begin = -1;
      }
    }
  }
  const text = texts.join("\n").trim();
  if (!text)
    throw new Error(
      "El agente terminó sin una respuesta visible. David puede revisar la conversación.",
    );
  return { text, session };
}
