export async function api<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path.startsWith("admin/"))
      window.location.assign("/login");
    throw new Error(value.error || "No se pudo completar la operación.");
  }
  return value;
}
export function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
}
export function dateLabel(value: string, timeOnly = false) {
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    ...(timeOnly
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  }).format(new Date(value));
}
export const channelNames: Record<string, string> = {
  web: "Web",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  telegram: "Telegram",
};
