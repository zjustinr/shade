import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __shadeDbClient: ReturnType<typeof postgres> | undefined;
}

function getClient() {
  // postgres.js connects lazily on first query, so it's safe to construct
  // this even when POSTGRES_URL is unset (e.g. during `next build`).
  // Anything that actually queries without a real URL will fail at that call site.
  const url = process.env.POSTGRES_URL ?? "postgres://unset:unset@localhost:5432/unset";
  // Reuse the connection across hot reloads / lambda warm starts.
  if (!global.__shadeDbClient) {
    global.__shadeDbClient = postgres(url, { max: 5 });
  }
  return global.__shadeDbClient;
}

export const db = drizzle(getClient(), { schema });
export * from "./schema";
