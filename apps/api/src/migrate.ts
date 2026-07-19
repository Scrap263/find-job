import { createDatabase, runMigrations } from "./database.js";

const database = createDatabase();

if (!database) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

try {
  await runMigrations(database);
  console.log("Database migration completed.");
} finally {
  await database.close();
}
