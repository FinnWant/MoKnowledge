import { Pool, type PoolClient } from "pg";

/**
 * One connection pool per process, shared by every request.
 *
 * In a serverless deployment each warm instance holds its own pool, so the
 * ceiling that matters is `max × instances`, not `max`. That is why the default
 * here is small: four connections per instance against Supabase's pooler is
 * already a lot of instances' worth of headroom, and the failure mode of
 * guessing high is that the pooler starts refusing connections for the whole
 * project rather than for the one instance that overreached.
 */

let pool: Pool | null = null;

export type PoolerMode = "session" | "transaction" | "direct";

/** Which endpoint the connection string points at, by port and host. */
export function poolerMode(connectionString: string): PoolerMode {
  const url = new URL(connectionString);
  if (!url.hostname.includes("pooler.")) return "direct";
  return url.port === "6543" ? "transaction" : "session";
}

export function connectionString(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. The app runs on LocalJsonAdapter without it; " +
        "set it only if you want Supabase persistence (see README).",
    );
  }
  return url;
}

export function getPool(): Pool {
  if (pool) return pool;

  const url = connectionString();
  const mode = poolerMode(url);

  if (mode === "direct") {
    // Not fatal — a project with the IPv4 add-on, or an IPv6 network, is fine.
    // But it is the most common way this fails to connect at all, so say so
    // once at startup rather than letting every request time out.
    console.warn(
      "[storage] SUPABASE_DB_URL points at the direct endpoint. That host is " +
        "IPv6-only without the IPv4 add-on; prefer the pooler if connections hang.",
    );
  }

  pool = new Pool({
    connectionString: url,
    // Supabase terminates TLS at the pooler with a certificate that does not
    // chain to a public root, which is why verification is off here. The
    // connection is still encrypted.
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.SUPABASE_POOL_MAX ?? 4),
    // Serverless instances go idle between bursts; holding sockets open past
    // that just occupies pooler slots another instance could use.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pooled client can be killed by the pooler between checkouts. Without a
  // listener, `pg` turns that into an unhandled 'error' event and takes the
  // process down — in a Next server, that is the whole app for one dead socket.
  pool.on("error", (error) => {
    console.error("[storage] idle client error:", error.message);
  });

  return pool;
}

/** For tests and scripts that need to exit cleanly. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
}

export type { PoolClient };
