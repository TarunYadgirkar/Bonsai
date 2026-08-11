import { neon } from '@neondatabase/serverless';
import { PersistenceConfigurationError } from './persistence/errors';

type Environment = Readonly<Record<string, string | undefined>>;
const MAX_UPSTASH_RESPONSE_BYTES = 32 * 1024 * 1024 + 1_024;

export interface KvTransport {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface CreateKvTransportOptions {
  env?: Environment;
  fetch?: typeof globalThis.fetch;
  neonFactory?: typeof neon;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

type KvConfiguration =
  | { kind: 'neon'; databaseUrl: string }
  | { kind: 'upstash'; url: string; token: string };

export function hasKvConfiguration(env: Environment = process.env): boolean {
  try {
    return resolveKvConfiguration(env) !== null;
  } catch {
    return false;
  }
}

export function createKvTransport(options: CreateKvTransportOptions = {}): KvTransport {
  const configuration = resolveKvConfiguration(options.env ?? process.env);
  if (!configuration) {
    throw new PersistenceConfigurationError('KV persistence is not configured');
  }
  if (configuration.kind === 'neon') {
    return createNeonTransport(configuration.databaseUrl, options.neonFactory ?? neon);
  }
  return createUpstashTransport(
    configuration.url,
    configuration.token,
    options.fetch ?? globalThis.fetch,
    options.timeoutMs ?? 3_000,
    resolveMaximumResponseBytes(options.maxResponseBytes),
  );
}

function resolveKvConfiguration(env: Environment): KvConfiguration | null {
  const databaseUrl = nonEmpty(env.DATABASE_URL);
  if (databaseUrl) return { kind: 'neon', databaseUrl };

  const url = nonEmpty(env.UPSTASH_REDIS_REST_URL) ?? nonEmpty(env.KV_REST_API_URL);
  const token =
    nonEmpty(env.UPSTASH_REDIS_REST_TOKEN) ?? nonEmpty(env.KV_REST_API_TOKEN);
  if (!url && !token) return null;
  if (!url || !token) {
    throw new PersistenceConfigurationError('KV persistence configuration is incomplete');
  }
  return { kind: 'upstash', url, token };
}

function createNeonTransport(databaseUrl: string, factory: typeof neon): KvTransport {
  return {
    async get(key) {
      try {
        const sql = factory(databaseUrl);
        const rows = (await sql`SELECT value FROM store_snapshot WHERE key = ${key}`) as {
          value: unknown;
        }[];
        return rows.length === 0 ? null : JSON.stringify(rows[0].value);
      } catch {
        throw new Error('KV request failed');
      }
    },
    async set(key, value) {
      try {
        const sql = factory(databaseUrl);
        await sql`
          INSERT INTO store_snapshot (key, value, updated_at)
          VALUES (${key}, ${value}::jsonb, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        `;
      } catch {
        throw new Error('KV request failed');
      }
    },
  };
}

function createUpstashTransport(
  url: string,
  token: string,
  fetch: typeof globalThis.fetch,
  timeoutMs: number,
  maxResponseBytes: number,
): KvTransport {
  const baseUrl = url.replace(/\/$/, '');
  return {
    async get(key) {
      try {
        const response = await fetch(`${baseUrl}/get/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error('non-2xx');
        const result = readUpstashResult(await readBoundedJson(response, maxResponseBytes));
        if (result === null) return null;
        if (typeof result !== 'string') throw new Error('malformed');
        return result;
      } catch {
        throw new Error('KV request failed');
      }
    },
    async set(key, value) {
      try {
        const response = await fetch(`${baseUrl}/set/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: value,
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error('non-2xx');
        if (readUpstashResult(await readBoundedJson(response, maxResponseBytes)) !== 'OK') {
          throw new Error('malformed');
        }
      } catch {
        throw new Error('KV request failed');
      }
    },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

function resolveMaximumResponseBytes(value: number | undefined): number {
  if (value === undefined) return MAX_UPSTASH_RESPONSE_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_UPSTASH_RESPONSE_BYTES) {
    throw new PersistenceConfigurationError('KV response limit is invalid');
  }
  return value;
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > maximumBytes
    ) {
      await response.body?.cancel();
      throw new Error('malformed');
    }
  }
  if (!response.body) throw new Error('malformed');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error('malformed');
    }
    chunks.push(chunk.value);
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes).toString(
    'utf8',
  )) as unknown;
}

function readUpstashResult(value: unknown): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !Object.prototype.hasOwnProperty.call(value, 'result')
  ) {
    throw new Error('malformed');
  }
  return (value as Record<string, unknown>).result;
}
