/**
 * One-time setup + round-trip proof for the Snowflake inference log.
 *
 *   npx tsx --env-file=.env.local scripts/setup-snowflake.ts
 *
 * Creates the database, schema and table, writes one probe row, reads it back, deletes it, then
 * prints what the table holds. Safe to re-run: every DDL is IF NOT EXISTS and the probe cleans up.
 * `--keep` skips the delete, `--count` skips setup and just reports the current row count.
 */
import {
  CREATE_TABLE_SQL,
  execSql,
  logTable,
  mirrorInferenceLogs,
  readInferenceLogs,
  snowflakeEnabled,
} from '../lib/snowflake';
import type { InferenceLog } from '../lib/types';

const DATABASE = process.env.SNOWFLAKE_DATABASE ?? 'BONSAI';
const SCHEMA = process.env.SNOWFLAKE_SCHEMA ?? 'PUBLIC';

async function main(): Promise<void> {
  // The app keeps the mirror off by default (see snowflakeEnabled); this script is the opt-in.
  process.env.SNOWFLAKE_LOG_ENABLED = '1';

  if (!snowflakeEnabled()) {
    console.error('SNOWFLAKE_ACCOUNT_URL / SNOWFLAKE_PAT missing — nothing to set up.');
    process.exit(1);
  }

  const table = logTable();
  const countOnly = process.argv.includes('--count');

  if (!countOnly) {
    console.log(`creating ${table} ...`);
    await execSql(`CREATE DATABASE IF NOT EXISTS ${DATABASE}`, [], false);
    await execSql(`CREATE SCHEMA IF NOT EXISTS ${DATABASE}.${SCHEMA}`, [], false);
    await execSql(CREATE_TABLE_SQL(table));

    const probe: InferenceLog = {
      id: `probe_${Date.now()}`,
      ts: new Date().toISOString(),
      branchId: 'probe',
      purpose: 'chat',
      tier: 'quick',
      model: 'setup-probe',
      inputTokens: 1,
      outputTokens: 2,
      estCostUsd: 0.000001,
      escalated: false,
      overridden: true,
      baselineInputTokens: 19013,
      baselineCostUsd: 0.1,
    };

    const wrote = await mirrorInferenceLogs([probe]);
    if (!wrote) throw new Error('insert reported failure — see the warning above');

    const read = await readInferenceLogs([probe.id]);
    const got = read?.[0];
    if (!got) throw new Error('probe row did not read back');
    const roundTripped =
      got.id === probe.id &&
      got.inputTokens === probe.inputTokens &&
      got.overridden === probe.overridden &&
      got.baselineInputTokens === probe.baselineInputTokens;
    console.log(`round trip ${roundTripped ? 'OK' : 'MISMATCH'}:`, got);
    if (!roundTripped) throw new Error('round trip mismatch — do not ship this');

    if (!process.argv.includes('--keep')) {
      await execSql(`DELETE FROM ${table} WHERE id = ?`, [probe.id]);
      console.log('probe row deleted');
    }
  }

  const { rows } = await execSql(`SELECT count(*), max(logged_at) FROM ${table}`);
  console.log(`${table}: ${rows[0]?.[0] ?? '0'} rows, last write ${rows[0]?.[1] ?? 'never'}`);
}

main().catch((err) => {
  console.error(`setup failed: ${(err as Error).message}`);
  process.exit(1);
});
