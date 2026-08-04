import type { D1Database } from '../../../functions/_lib/runtime.ts';

export const REQUIRED_TRACKING_MIGRATIONS = [
  '0001_tracking_ledger.sql',
  '0002_tracking_scope_hardening.sql',
  '0003_csrf_nonce_bindings.sql',
  '0004_delivery_safety.sql',
  '0005_runtime_safety.sql',
] as const;

type RuntimeSafetyEnv = Record<string, unknown> & { TRACKING_DB: D1Database };

export async function assertRuntimeReady(env: RuntimeSafetyEnv): Promise<void> {
  const migrationSetSha = env.TRACKING_MIGRATION_SET_SHA;
  const releaseSha = env.TRACKING_RELEASE_SHA;
  if (
    typeof migrationSetSha !== 'string' ||
    !/^[a-f0-9]{64}$/.test(migrationSetSha) ||
    typeof releaseSha !== 'string' ||
    !/^[a-f0-9]{40,64}$/.test(releaseSha)
  )
    throw new Error('tracking_release_binding_missing');
  const row = await env.TRACKING_DB.prepare(
    `SELECT migration_names_json, migration_set_sha, release_sha, lock_state
       FROM tracking_runtime_release_state WHERE state_key = 'active' LIMIT 1`
  ).first<{
    migration_names_json: string;
    migration_set_sha: string;
    release_sha: string;
    lock_state: string;
  }>();
  let names: unknown = null;
  try {
    names = row ? JSON.parse(row.migration_names_json) : null;
  } catch {
    names = null;
  }
  if (
    !row ||
    row.lock_state !== 'ready' ||
    row.migration_set_sha !== migrationSetSha ||
    row.release_sha !== releaseSha ||
    JSON.stringify(names) !== JSON.stringify(REQUIRED_TRACKING_MIGRATIONS)
  )
    throw new Error('tracking_migrations_not_ready');
}
