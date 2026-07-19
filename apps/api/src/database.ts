import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

export type Database = {
  pool: Pool;
  close: () => Promise<void>;
};

export function createDatabase(connectionString = process.env.DATABASE_URL): Database | null {
  if (!connectionString) return null;

  const pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5)
  });

  return {
    pool,
    close: () => pool.end()
  };
}

export async function runMigrations(database: Database) {
  const migrationPath = fileURLToPath(
    new URL("../../../infra/migrations/001_initial.sql", import.meta.url)
  );
  const sql = await readFile(migrationPath, "utf8");
  const client = await database.pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  database: Database,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await database.pool.connect();

  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
