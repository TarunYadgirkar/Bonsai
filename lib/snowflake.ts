/**
 * Snowflake SQL API mirror for the inference log.
 *
 * Cortex inference is barred on this account (AGENTS.md → CLOSED), but the SQL API works on the
 * same PAT, so this is the path by which the demo genuinely touches Snowflake: every inference is
 * INSERTed here, and /api/economics reads the panel's rows back out with a SELECT.
 *
 * Mock-first (AGENTS.md): with no SNOWFLAKE_ env vars this module is inert and logging falls back
 * to data/inference-log.json. Every failure is caught, logged one line, and degraded — a dead
 * warehouse must never take the demo down (rule 8).
 */
import { promises as fs } from 'fs';
import path from 'path';
import type { InferenceLog, InferencePurpose, Tier } from './types';

const ACCOUNT_URL = process.env.SNOWFLAKE_ACCOUNT_URL;
const PAT = process.env.SNOWFLAKE_PAT;
const DATABASE = process.env.SNOWFLAKE_DATABASE ?? 'BONSAI';
const SCHEMA = process.env.SNOWFLAKE_SCHEMA ?? 'PUBLIC';
const TABLE = process.env.SNOWFLAKE_LOG_TABLE ?? 'INFERENCE_LOG';
const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE ?? 'COMPUTE_WH';
const ROLE = process.env.SNOWFLAKE_ROLE ?? 'ACCOUNTADMIN';

/** Statement timeout Snowflake enforces, and the client-side abort. A cold warehouse can take ~5s. */
const SQL_TIMEOUT_S = 20;
const ABORT_MS = 12_000;

const LOCAL_PATH = path.join(process.cwd(), 'data', 'inference-log.json');
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * Off unless SNOWFLAKE_LOG_ENABLED=1, even with credentials present. Cortex is barred on this
 * account, so Snowflake is not part of the shipped demo; the vars still sit in .env.local for the
 * SQL API, and without this gate every inference would pay a doomed insert round trip on the demo
 * path. Set the flag only once `scripts/setup-snowflake.ts` has created the table.
 */
export function snowflakeEnabled(): boolean {
  return Boolean(ACCOUNT_URL && PAT && process.env.SNOWFLAKE_LOG_ENABLED === '1');
}

/** Fully qualified target. Identifiers come from env, so they are validated, never interpolated blind. */
export function logTable(): string {
  for (const part of [DATABASE, SCHEMA, TABLE]) {
    if (!IDENTIFIER.test(part)) throw new Error(`invalid Snowflake identifier: ${part}`);
  }
  return `${DATABASE}.${SCHEMA}.${TABLE}`;
}

export interface SqlBinding {
  type: 'TEXT';
  value: string;
}

export interface SqlResult {
  rows: string[][];
  numRows: number;
}

/**
 * One statement, synchronous. Values bind as TEXT and are cast in SQL — Snowflake's binding type
 * names differ per column type and a wrong one is a 422; one type plus explicit casts can't drift.
 */
export async function execSql(
  statement: string,
  values: string[] = [],
  /** Off for the DDL that creates the database/schema — naming them as context before they exist errors. */
  useContext = true,
): Promise<SqlResult> {
  if (!snowflakeEnabled()) throw new Error('snowflake not configured');

  const bindings: Record<string, SqlBinding> = {};
  values.forEach((value, i) => {
    bindings[String(i + 1)] = { type: 'TEXT', value };
  });

  const res = await fetch(`${ACCOUNT_URL}/api/v2/statements`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
    },
    body: JSON.stringify({
      statement,
      timeout: SQL_TIMEOUT_S,
      ...(useContext ? { database: DATABASE, schema: SCHEMA } : {}),
      warehouse: WAREHOUSE,
      role: ROLE,
      ...(values.length ? { bindings } : {}),
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(ABORT_MS),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new Error(`sql ${res.status} ${body?.code ?? ''} ${body?.message ?? ''}`.trim());
  }

  const body = (await res.json()) as {
    data?: string[][];
    resultSetMetaData?: { numRows?: number };
  };
  return { rows: body.data ?? [], numRows: body.resultSetMetaData?.numRows ?? 0 };
}

const COLUMNS =
  'id, ts, branch_id, purpose, tier, model, input_tokens, output_tokens, est_cost_usd, escalated, overridden, baseline_input_tokens, baseline_cost_usd';

const ROW_CAST =
  'SELECT ?, ?, ?, ?, ?, ?, ?::NUMBER, ?::NUMBER, ?::FLOAT, ?::BOOLEAN, ?::BOOLEAN, ?::NUMBER, ?::FLOAT';

export const CREATE_TABLE_SQL = (table: string): string => `
CREATE TABLE IF NOT EXISTS ${table} (
  id STRING,
  ts STRING,
  branch_id STRING,
  purpose STRING,
  tier STRING,
  model STRING,
  input_tokens NUMBER,
  output_tokens NUMBER,
  est_cost_usd FLOAT,
  escalated BOOLEAN,
  overridden BOOLEAN,
  baseline_input_tokens NUMBER,
  baseline_cost_usd FLOAT,
  logged_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
)`;

function bindValues(log: InferenceLog): string[] {
  return [
    log.id,
    log.ts,
    log.branchId,
    log.purpose,
    log.tier,
    log.model,
    String(log.inputTokens),
    String(log.outputTokens),
    String(log.estCostUsd),
    String(log.escalated),
    String(log.overridden),
    String(log.baselineInputTokens),
    String(log.baselineCostUsd),
  ];
}

/**
 * Mirror rows to Snowflake, always also to the local JSON file. Returns whether Snowflake took
 * them — the caller uses that only for logging, never to decide whether to answer.
 */
export async function mirrorInferenceLogs(logs: InferenceLog[]): Promise<boolean> {
  if (!logs.length) return false;
  await appendLocalLogs(logs);
  if (!snowflakeEnabled()) return false;

  try {
    const statement = `INSERT INTO ${logTable()} (${COLUMNS})\n${logs
      .map(() => ROW_CAST)
      .join('\nUNION ALL\n')}`;
    await execSql(statement, logs.flatMap(bindValues));
    return true;
  } catch (err) {
    console.warn(`[snowflake] insert failed (${(err as Error).message}) — local log only`);
    return false;
  }
}

/**
 * Read back exactly the rows for `ids`, newest write per id. Null means "could not read" — the
 * caller keeps its in-memory logs rather than showing a short table on stage.
 */
export async function readInferenceLogs(ids: string[]): Promise<InferenceLog[] | null> {
  if (!snowflakeEnabled() || !ids.length) return null;

  try {
    const statement = `
      SELECT ${COLUMNS}
      FROM ${logTable()}
      WHERE ARRAY_CONTAINS(id::VARIANT, PARSE_JSON(?))
      QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY logged_at DESC) = 1
      ORDER BY logged_at, id`;
    const { rows } = await execSql(statement, [JSON.stringify(ids)]);
    return rows.map(toLog);
  } catch (err) {
    console.warn(`[snowflake] read failed (${(err as Error).message}) — serving in-memory logs`);
    return null;
  }
}

/** Every SQL API value arrives as a string; the column order is COLUMNS. */
function toLog(row: string[]): InferenceLog {
  return {
    id: row[0],
    ts: row[1],
    branchId: row[2],
    purpose: row[3] as InferencePurpose,
    tier: row[4] as Tier,
    model: row[5],
    inputTokens: Number(row[6]),
    outputTokens: Number(row[7]),
    estCostUsd: Number(row[8]),
    escalated: row[9] === 'true',
    overridden: row[10] === 'true',
    baselineInputTokens: Number(row[11]),
    baselineCostUsd: Number(row[12]),
  };
}

/* ---------- local fallback ---------- */

async function appendLocalLogs(logs: InferenceLog[]): Promise<void> {
  try {
    const existing = await readLocalLogs();
    const seen = new Set(existing.map((l) => l.id));
    const merged = [...existing, ...logs.filter((l) => !seen.has(l.id))];
    await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
    await fs.writeFile(LOCAL_PATH, JSON.stringify(merged, null, 2));
  } catch {
    // Vercel's filesystem is read-only outside /tmp; losing the local mirror is survivable.
  }
}

async function readLocalLogs(): Promise<InferenceLog[]> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_PATH, 'utf8')) as InferenceLog[];
  } catch {
    return [];
  }
}
