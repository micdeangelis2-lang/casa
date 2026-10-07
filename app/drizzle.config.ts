import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/platform/db/schema/index.ts",
  out: "./drizzle",
  // Le migrazioni si generano senza database; DATABASE_URL serve solo a `drizzle-kit push/studio`.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
