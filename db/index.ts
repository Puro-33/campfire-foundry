import { env } from "cloudflare:workers";
import { SCHEMA_STATEMENTS } from "./schema";

let schemaReady: Promise<void> | null = null;

async function initialize(db: D1Database) {
  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
  await db.prepare("PRAGMA optimize").run();
}

export async function getD1() {
  const db = env.DB;
  if (!db) throw new Error("Cloudflare D1 binding DB is unavailable");
  schemaReady ??= initialize(db);
  await schemaReady;
  return db;
}

