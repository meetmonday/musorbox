import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";
import { config } from "./config";

let sqlite: Database | null = null;

export function getDb() {
  if (!sqlite) {
    sqlite = new Database(config.dbPath);
    sqlite.exec("PRAGMA foreign_keys = ON;");
    sqlite.exec("PRAGMA journal_mode = WAL;");
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: "./drizzle" });
  }
  return sqlite;
}

export function getDrizzle() {
  return drizzle(getDb(), { schema });
}

export type Db = ReturnType<typeof getDrizzle>;