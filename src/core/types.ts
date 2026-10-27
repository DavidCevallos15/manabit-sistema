export type Channel =
  | "web"
  | "whatsapp"
  | "messenger"
  | "instagram"
  | "telegram";
export type BookingStatus = "pending_confirmation" | "confirmed" | "cancelled";
export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type Hours = { day: Day; from: string; to: string };

export interface BusinessConfig {
  id: string;
  name: string;
  sector: "consultorio" | "barberia" | "taller" | "software";
  timeZone: string;
  slotStepMinutes: number;
  confirmation: "automatic" | "reception";
  closedDates: readonly string[];
  hours: readonly Hours[];
  labels: { customer: string; provider: string; appointment: string };
  brand: { logo: string | null; accent: string; displayName: string };
  services: readonly {
    id: string;
    name: string;
    durationMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
  }[];
  professionals: readonly {
    id: string;
    name: string;
    serviceIds: readonly string[];
    hours: readonly Hours[];
  }[];
}

export interface BookingInput {
  serviceId: string;
  professionalId: string;
  customerRef: string;
  /** ISO 8601 con Z u offset explícito. Nunca una hora local ambigua. */
  startAt: string;
  channel: Channel;
  /** La persona ya aceptó el resumen de fecha, hora, servicio y profesional. */
  accepted: boolean;
  /** Única por operación; una reentrega idéntica devuelve la misma reserva. */
  idempotencyKey: string;
  meeting?: { mode: "videollamada" | "presencial"; location: string };
}

export interface Booking {
  id: string;
  tenantId: string;
  serviceId: string;
  professionalId: string;
  customerRef: string;
  channel: Channel;
  startAt: string;
  endAt: string;
  blockedStartAt: string;
  blockedEndAt: string;
  status: BookingStatus;
  idempotencyKey: string;
  requestFingerprint: string;
  meeting?: { mode: "videollamada" | "presencial"; location: string };
}

/** En producción, insert debe ser atómico también entre procesos/instancias. */
export interface BookingRepository {
  insertIfAvailable(booking: Booking): Promise<Booking>;
  list(tenantId: string): Promise<Booking[]>;
  cancel(tenantId: string, bookingId: string): Promise<void>;
}

/** Contrato futuro. No hay conexiones a Meta ni envíos implementados todavía. */
export interface IncomingMessage {
  providerEventId: string;
  channel: Channel;
  connectionId: string;
  senderId: string;
  text: string;
  receivedAt: string;
}
