import { Firestore, type CollectionReference } from "@google-cloud/firestore";
import { BookingError } from "../core/booking.ts";
import type { Booking, BookingRepository } from "../core/types.ts";
import type { Store } from "./db.ts";

/*
 * Firestore (modo nativo) para Cloud Run. Misma semántica que el almacén SQL:
 *   tenants/{tenant}/{kind}/{id}            registros JSON (payload + createdAt)
 *   tenants/{tenant}/appointments/{id}      citas
 *   tenants/{tenant}/appointmentKeys/{key}  unicidad de idempotencia
 *   tenants/{tenant}/agendaLocks/{prof}     serializa reservas del mismo profesional
 *   leases/{name}, rate_limits/{id}         coordinación entre procesos
 * Las reservas se validan dentro de una transacción que escribe el lock del
 * profesional: dos reservas concurrentes chocan y la segunda ve la primera.
 */

const ALREADY_EXISTS = 6;
const code = (e: unknown) =>
  e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined;

/** IDs válidos en Firestore: sin "/", ni "." / "..", ni "__x__". */
export function docId(value: string) {
  const id = encodeURIComponent(value).replace(/\./g, "%2E");
  return id.startsWith("__") ? `%5F${id.slice(1)}` : id;
}

export function createFirestoreStore(options?: {
  projectId?: string;
  databaseId?: string;
  cacheSeconds?: number;
}): Store {
  const db = new Firestore({
    projectId: options?.projectId ?? (process.env.FIRESTORE_PROJECT_ID || undefined),
    databaseId: options?.databaseId ?? (process.env.FIRESTORE_DATABASE_ID || "(default)"),
  });
  const tenantDoc = (tenant: string) => db.collection("tenants").doc(docId(tenant));
  const records = (tenant: string, kind: string) =>
    tenantDoc(tenant).collection(kind);
  const appointments = (tenant: string) => tenantDoc(tenant).collection("appointments");

  // Caché de listados: el panel consulta cada pocos segundos y Firestore cobra por
  // documento leído. Se invalida en cada escritura de este proceso; con varias
  // instancias, el TTL acota cuánto puede tardar en verse un cambio ajeno.
  const ttl = (options?.cacheSeconds ?? Number(process.env.FIRESTORE_LIST_CACHE_SECONDS ?? 60)) * 1000;
  const cache = new Map<string, { at: number; value: Promise<string[]> }>();
  function cached(key: string, load: () => Promise<string[]>) {
    if (ttl <= 0) return load();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = load();
    cache.set(key, { at: Date.now(), value });
    value.catch(() => cache.delete(key));
    return value;
  }
  const parse = <T>(payloads: string[]) => payloads.map((p) => JSON.parse(p) as T);
  const payloads = async (col: CollectionReference, order: string, dir: "asc" | "desc") =>
    (await col.orderBy(order, dir).get()).docs.map((d) => String(d.get("payload")));

  const bookings: BookingRepository = {
    async list(tenant) {
      return parse<Booking>(
        await cached(`appointments:${tenant}`, () =>
          payloads(appointments(tenant), "blockedStart", "asc"),
        ),
      );
    },
    async insertIfAvailable(booking) {
      const t = booking.tenantId;
      const ref = appointments(t).doc(docId(booking.id));
      const key = tenantDoc(t).collection("appointmentKeys").doc(docId(booking.idempotencyKey));
      const lock = tenantDoc(t).collection("agendaLocks").doc(docId(booking.professionalId));
      try {
        return await db.runTransaction(async (tx) => {
          const [keySnap, lockSnap] = await tx.getAll(key, lock);
          if (keySnap?.exists) {
            const sameSnap = await tx.get(appointments(t).doc(String(keySnap.get("appointment"))));
            const same = JSON.parse(String(sameSnap.get("payload"))) as Booking;
            if (same.requestFingerprint !== booking.requestFingerprint)
              throw new BookingError("IDEMPOTENCY_CONFLICT", "La operación ya tiene otros datos.");
            return same;
          }
          // Igualdad simple: no requiere índice compuesto; el solape se filtra aquí.
          const busy = await tx.get(
            appointments(t).where("professional", "==", booking.professionalId),
          );
          const taken = busy.docs.some(
            (d) =>
              d.get("status") !== "cancelled" &&
              String(d.get("blockedStart")) < booking.blockedEndAt &&
              String(d.get("blockedEnd")) > booking.blockedStartAt,
          );
          if (taken)
            throw new BookingError("SLOT_TAKEN", "Ese horario se acaba de ocupar. Elige otro.");
          tx.create(ref, {
            professional: booking.professionalId,
            blockedStart: booking.blockedStartAt,
            blockedEnd: booking.blockedEndAt,
            status: booking.status,
            idem: booking.idempotencyKey,
            payload: JSON.stringify(booking),
          });
          tx.create(key, { appointment: docId(booking.id) });
          tx.set(lock, { version: (Number(lockSnap?.get("version")) || 0) + 1 });
          return booking;
        });
      } finally {
        cache.delete(`appointments:${t}`);
      }
    },
    async cancel(tenant, id) {
      const ref = appointments(tenant).doc(docId(id));
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw new BookingError("NOT_FOUND", "No existe esa cita.");
          const booking = JSON.parse(String(snap.get("payload"))) as Booking;
          booking.status = "cancelled";
          tx.update(ref, { status: booking.status, payload: JSON.stringify(booking) });
        });
      } finally {
        cache.delete(`appointments:${tenant}`);
      }
    },
  };

  return {
    kind: "firestore",
    async listRecords<T>(kind: string, tenant: string) {
      return parse<T>(
        await cached(`records:${tenant}:${kind}`, () =>
          payloads(records(tenant, kind), "createdAt", "desc"),
        ),
      );
    },
    async getRecord<T>(kind: string, id: string, tenant: string) {
      const snap = await records(tenant, kind).doc(docId(id)).get();
      return snap.exists ? (JSON.parse(String(snap.get("payload"))) as T) : undefined;
    },
    async putRecord(kind, id, data, tenant) {
      const ref = records(tenant, kind).doc(docId(id));
      const payload = JSON.stringify(data);
      try {
        // Igual que SQL: createdAt se fija al crear y no cambia en actualizaciones.
        await ref.create({ payload, createdAt: new Date().toISOString() });
      } catch (e) {
        if (code(e) !== ALREADY_EXISTS) throw e;
        await ref.update({ payload });
      } finally {
        cache.delete(`records:${tenant}:${kind}`);
      }
    },
    async claimRecord(kind, id, data, tenant) {
      try {
        await records(tenant, kind)
          .doc(docId(id))
          .create({ payload: JSON.stringify(data), createdAt: new Date().toISOString() });
        return true;
      } catch (e) {
        if (code(e) === ALREADY_EXISTS) return false;
        throw e;
      } finally {
        cache.delete(`records:${tenant}:${kind}`);
      }
    },
    async acquireLease(name, token) {
      const ref = db.collection("leases").doc(docId(name));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && String(snap.get("expiresAt")) >= new Date().toISOString())
          return false;
        tx.set(ref, { token, expiresAt: new Date(Date.now() + 120_000).toISOString() });
        return true;
      });
    },
    async releaseLease(name, token) {
      const ref = db.collection("leases").doc(docId(name));
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.get("token") === token) tx.delete(ref);
      });
    },
    async consumeLimit(id, maximum, seconds) {
      const ref = db.collection("rate_limits").doc(docId(id));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Date.now();
        const current = snap.exists && Number(snap.get("expires")) >= now;
        const count = current ? Number(snap.get("count")) + 1 : 1;
        const expires = current ? Number(snap.get("expires")) : now + seconds * 1000;
        // expireAt permite una política TTL de Firestore que borre contadores vencidos.
        tx.set(ref, { count, expires, expireAt: new Date(expires) });
        return count <= maximum;
      });
    },
    bookings,
  };
}
