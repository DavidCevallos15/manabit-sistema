import { mkdirSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { BookingError } from "../core/booking.ts";
import type { Booking, BookingRepository } from "../core/types.ts";

type Result = { rows: Record<string, unknown>[]; changes: number };
export interface DB {
  dialect: "sqlite" | "postgres";
  query(sql: string, params?: unknown[]): Promise<Result>;
}
let singleton: Promise<DB> | undefined;

const schema = `CREATE TABLE IF NOT EXISTS records (
  tenant TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(tenant, kind, id)
);
CREATE TABLE IF NOT EXISTS appointments (
  tenant TEXT NOT NULL, id TEXT NOT NULL, professional TEXT NOT NULL,
  blocked_start TEXT NOT NULL, blocked_end TEXT NOT NULL, status TEXT NOT NULL,
  idem TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(tenant,id), UNIQUE(tenant,idem)
);
CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires BIGINT NOT NULL);`;

async function open(): Promise<DB> {
  let db: DB;
  if (process.env.DATABASE_URL) {
    // Supabase/pooler con CA propia: pasa el certificado en DATABASE_CA_CERT y verifica el host.
    // pg prioriza sslmode de la URL sobre la opción ssl, así que no se permiten ambos.
    const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
    if (ca && /[?&]sslmode=/i.test(process.env.DATABASE_URL))
      throw new Error(
        "Quita sslmode de DATABASE_URL cuando configures DATABASE_CA_CERT.",
      );
    if (process.env.K_SERVICE && !ca && !/[?&]sslmode=/i.test(process.env.DATABASE_URL))
      throw new Error(
        "En Cloud Run la base necesita TLS: configura DATABASE_CA_CERT o sslmode.",
      );
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    });
    db = {
      dialect: "postgres",
      async query(sql, params = []) {
        const r = await pool.query(sql, params);
        return { rows: r.rows, changes: r.rowCount ?? 0 };
      },
    };
    await db.query(
      schema
        .replace("blocked_start TEXT", "blocked_start TIMESTAMPTZ")
        .replace("blocked_end TEXT", "blocked_end TIMESTAMPTZ"),
    );
    // La exclusión se crea una vez al migrar; falla de forma visible si falta el permiso.
    await db.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
    await db.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='manabit_no_overlap') THEN
      ALTER TABLE appointments ADD CONSTRAINT manabit_no_overlap EXCLUDE USING gist
      (tenant WITH =, professional WITH =, tstzrange(blocked_start, blocked_end, '[)') WITH &&)
      WHERE (status <> 'cancelled'); END IF; END $$`);
  } else {
    if (process.env.K_SERVICE)
      throw new Error(
        "Cloud Run necesita DATABASE_BACKEND=firestore o DATABASE_URL de PostgreSQL; SQLite local no se usa en la nube.",
      );
    const { DatabaseSync } = await import("node:sqlite");
    const directory = path.resolve(
      /* turbopackIgnore: true */ process.env.MANABIT_DATA_DIR || ".data",
    );
    mkdirSync(directory, { recursive: true });
    const sqlite = new DatabaseSync(path.join(directory, "manabit.sqlite"));
    sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    sqlite.exec(schema);
    db = {
      dialect: "sqlite",
      async query(sql, params = []) {
        const statement = sqlite.prepare(sql.replace(/\$\d+/g, "?"));
        if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))
          return {
            rows: statement.all(
              ...(params as (string | number | null)[]),
            ) as Record<string, unknown>[],
            changes: 0,
          };
        const r = statement.run(...(params as (string | number | null)[]));
        return { rows: [], changes: Number(r.changes) };
      },
    };
  }
  return db;
}
export function database() {
  return (singleton ??= open().catch((e) => {
    singleton = undefined;
    throw e;
  }));
}
/** Operaciones de persistencia; SQL (SQLite local / PostgreSQL) o Firestore en Cloud Run. */
export interface Store {
  kind: "sql" | "firestore";
  listRecords<T>(kind: string, tenant: string): Promise<T[]>;
  getRecord<T>(kind: string, id: string, tenant: string): Promise<T | undefined>;
  putRecord(kind: string, id: string, data: unknown, tenant: string): Promise<void>;
  /** Crea solo si no existe; true si este proceso lo creó. */
  claimRecord(kind: string, id: string, data: unknown, tenant: string): Promise<boolean>;
  acquireLease(name: string, token: string): Promise<boolean>;
  releaseLease(name: string, token: string): Promise<void>;
  consumeLimit(id: string, maximum: number, seconds: number): Promise<boolean>;
  bookings: BookingRepository;
}

const sqlBookings: BookingRepository = {
  async list(tenant) {
    const db = await database();
    const r = await db.query(
      "SELECT payload FROM appointments WHERE tenant=$1 ORDER BY blocked_start",
      [tenant],
    );
    return r.rows.map((row) => JSON.parse(String(row.payload)) as Booking);
  },
  async insertIfAvailable(booking) {
    const db = await database();
    try {
      const same = (await this.list(booking.tenantId)).find(
        (b) => b.idempotencyKey === booking.idempotencyKey,
      );
      if (same) {
        if (same.requestFingerprint !== booking.requestFingerprint)
          throw new BookingError(
            "IDEMPOTENCY_CONFLICT",
            "La operación ya tiene otros datos.",
          );
        return same;
      }
      // SQLite ejecuta este INSERT...SELECT de forma atómica; PostgreSQL añade exclusión de rangos.
      const r = await db.query(
        `INSERT INTO appointments(tenant,id,professional,blocked_start,blocked_end,status,idem,payload)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS
        (SELECT 1 FROM appointments WHERE tenant=$9 AND professional=$10 AND status<>'cancelled' AND blocked_start<$11 AND blocked_end>$12)`,
        [
          booking.tenantId,
          booking.id,
          booking.professionalId,
          booking.blockedStartAt,
          booking.blockedEndAt,
          booking.status,
          booking.idempotencyKey,
          JSON.stringify(booking),
          booking.tenantId,
          booking.professionalId,
          booking.blockedEndAt,
          booking.blockedStartAt,
        ],
      );
      if (!r.changes)
        throw new BookingError(
          "SLOT_TAKEN",
          "Ese horario se acaba de ocupar. Elige otro.",
        );
      return booking;
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        ["23505", "SQLITE_CONSTRAINT_UNIQUE"].includes(String(e.code))
      ) {
        const same = (await this.list(booking.tenantId)).find(
          (b) => b.idempotencyKey === booking.idempotencyKey,
        );
        if (same?.requestFingerprint === booking.requestFingerprint)
          return same;
      }
      if (e && typeof e === "object" && "code" in e && e.code === "23P01")
        throw new BookingError("SLOT_TAKEN", "Ese horario ya está ocupado.");
      throw e;
    }
  },
  async cancel(tenant, id) {
    const booking = (await this.list(tenant)).find((b) => b.id === id);
    if (!booking) throw new BookingError("NOT_FOUND", "No existe esa cita.");
    booking.status = "cancelled";
    const db = await database();
    await db.query(
      "UPDATE appointments SET status=$1,payload=$2 WHERE tenant=$3 AND id=$4",
      [booking.status, JSON.stringify(booking), tenant, id],
    );
  },
};

const sqlStore: Store = {
  kind: "sql",
  async listRecords<T>(kind: string, tenant: string) {
    const db = await database();
    const r = await db.query(
      "SELECT payload FROM records WHERE tenant=$1 AND kind=$2 ORDER BY created_at DESC",
      [tenant, kind],
    );
    return r.rows.map((row) => JSON.parse(String(row.payload)) as T);
  },
  async getRecord<T>(kind: string, id: string, tenant: string) {
    const db = await database();
    const r = await db.query(
      "SELECT payload FROM records WHERE tenant=$1 AND kind=$2 AND id=$3",
      [tenant, kind, id],
    );
    return r.rows[0] ? (JSON.parse(String(r.rows[0].payload)) as T) : undefined;
  },
  async putRecord(kind, id, data, tenant) {
    const db = await database();
    await db.query(
      `INSERT INTO records(tenant,kind,id,payload,created_at) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(tenant,kind,id) DO UPDATE SET payload=excluded.payload`,
      [tenant, kind, id, JSON.stringify(data), new Date().toISOString()],
    );
  },
  async claimRecord(kind, id, data, tenant) {
    const db = await database();
    const r = await db.query(
      "INSERT INTO records(tenant,kind,id,payload,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [tenant, kind, id, JSON.stringify(data), new Date().toISOString()],
    );
    return r.changes === 1;
  },
  async acquireLease(name, token) {
    const db = await database();
    const now = new Date().toISOString();
    const r = await db.query(
      `INSERT INTO leases(name,token,expires_at) VALUES($1,$2,$3)
      ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE leases.expires_at<$4`,
      [name, token, new Date(Date.now() + 120_000).toISOString(), now],
    );
    return r.changes === 1;
  },
  async releaseLease(name, token) {
    const db = await database();
    await db.query("DELETE FROM leases WHERE name=$1 AND token=$2", [
      name,
      token,
    ]);
  },
  async consumeLimit(id, maximum, seconds) {
    const db = await database();
    const now = Date.now();
    const expires = now + seconds * 1000;
    await db.query(
      `INSERT INTO rate_limits(id,count,expires) VALUES($1,1,$2) ON CONFLICT(id) DO UPDATE SET
      count=CASE WHEN rate_limits.expires<$3 THEN 1 ELSE rate_limits.count+1 END,
      expires=CASE WHEN rate_limits.expires<$4 THEN excluded.expires ELSE rate_limits.expires END`,
      [id, expires, now, now],
    );
    const r = await db.query("SELECT count FROM rate_limits WHERE id=$1", [id]);
    return Number(r.rows[0]?.count) <= maximum;
  },
  bookings: sqlBookings,
};

let selected: Promise<Store> | undefined;
/** DATABASE_BACKEND=firestore en Cloud Run; sin él, PostgreSQL si hay DATABASE_URL o SQLite local. */
export function store(): Promise<Store> {
  return (selected ??= (async () => {
    const backend = process.env.DATABASE_BACKEND || "sql";
    if (backend === "firestore") {
      const { createFirestoreStore } = await import("./firestore-store.ts");
      return createFirestoreStore();
    }
    if (backend !== "sql")
      throw new Error("DATABASE_BACKEND admite 'sql' o 'firestore'.");
    return sqlStore;
  })().catch((e) => {
    selected = undefined;
    throw e;
  }));
}

export async function listRecords<T>(kind: string, tenant = "manabit") {
  return (await store()).listRecords<T>(kind, tenant);
}
export async function getRecord<T>(kind: string, id: string, tenant = "manabit") {
  return (await store()).getRecord<T>(kind, id, tenant);
}
export async function putRecord(kind: string, id: string, data: unknown, tenant = "manabit") {
  return (await store()).putRecord(kind, id, data, tenant);
}
export async function claimRecord(kind: string, id: string, data: unknown, tenant = "manabit") {
  return (await store()).claimRecord(kind, id, data, tenant);
}
export async function acquireLease(name: string, token: string) {
  return (await store()).acquireLease(name, token);
}
export async function releaseLease(name: string, token: string) {
  return (await store()).releaseLease(name, token);
}
export async function consumeLimit(id: string, maximum: number, seconds: number) {
  return (await store()).consumeLimit(id, maximum, seconds);
}
