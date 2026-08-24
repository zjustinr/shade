import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __shadeDbClient: ReturnType<typeof postgres> | undefined;
}

/**
 * Whether a database is configured at all. The public pages are readable
 * without one — the shade model is static — so a deployment with no
 * POSTGRES_URL should render an empty readings layer rather than fail.
 * Callers check this instead of waiting on a connection that cannot succeed.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.POSTGRES_URL);
}

function getClient() {
  // postgres.js connects lazily on first query, so it's safe to construct
  // this even when POSTGRES_URL is unset (e.g. during `next build`).
  // Anything that actually queries without a real URL fails at that call
  // site, quickly, rather than hanging the build.
  const url = process.env.POSTGRES_URL ?? "postgres://unset:unset@localhost:5432/unset";
  // Reuse the connection across hot reloads / lambda warm starts.
  if (!global.__shadeDbClient) {
    global.__shadeDbClient = postgres(url, { max: 5, connect_timeout: 10 });
  }
  return global.__shadeDbClient;
}

export const db = drizzle(getClient(), { schema });
export * from "./schema";
