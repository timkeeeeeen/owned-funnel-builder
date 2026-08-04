import type { D1Database } from '../../../functions/_lib/runtime.ts';
import { redactError } from './observability.ts';

export type CleanupResult = { expiredEvents: number; expiredDeliveries: number; watermark: string };

const DEFAULT_CLEANUP_BATCH_SIZE = 1_500;
const MAX_CLEANUP_BATCH_SIZE = 5_000;

function numberEnv(
  env: Record<string, unknown>,
  key: string,
  fallback: number,
  maximum: number
): number {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), maximum) : fallback;
}

export async function runCleanup(
  env: Record<string, unknown>,
  now = new Date()
): Promise<CleanupResult> {
  const database = env.TRACKING_DB as D1Database | undefined;
  if (!database) return { expiredEvents: 0, expiredDeliveries: 0, watermark: now.toISOString() };
  const retentionDays = numberEnv(env, 'TRACKING_RETENTION_DAYS', 395, 3_650);
  const batchSize = numberEnv(
    env,
    'TRACKING_CLEANUP_BATCH_SIZE',
    DEFAULT_CLEANUP_BATCH_SIZE,
    MAX_CLEANUP_BATCH_SIZE
  );
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const sensitiveCutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const budgetCutoff = Math.floor(now.getTime() / 60_000) * 60;
  let expiredEvents = 0;
  let expiredDeliveries = 0;
  try {
    await database
      .prepare(
        `DELETE FROM tracking_nonces WHERE rowid IN (
           SELECT rowid FROM tracking_nonces WHERE expires_at < ? LIMIT ?)`
      )
      .bind(now.toISOString(), batchSize)
      .run();
    // Canonical envelopes are JSON: remove retry context before its seven-day ceiling.
    await database.prepare(
      `UPDATE tracking_events SET envelope_json = json_remove(envelope_json,
        '$.device.user_agent', '$.geo', '$.attribution.fbp', '$.attribution.fbc',
        '$.identity.meta_hash', '$.buyer_context') WHERE received_at < ?`
    ).bind(sensitiveCutoff).run();
    await database.prepare(
      `UPDATE tracking_events SET buyer_context_json = '{}' WHERE received_at < ?`
    ).bind(sensitiveCutoff).run();
    await database.prepare(
      `UPDATE tracking_context_exchanges SET buyer_context_json = '{}' WHERE issued_at < ?`
    ).bind(sensitiveCutoff).run();
    await database.prepare(
      `DELETE FROM tracking_buyer_context WHERE rowid IN (
         SELECT rowid FROM tracking_buyer_context WHERE captured_at < ? LIMIT ?)`
    ).bind(sensitiveCutoff, batchSize).run();
    await database
      .prepare(
        `DELETE FROM tracking_delivery_budgets WHERE rowid IN (
           SELECT rowid FROM tracking_delivery_budgets WHERE window_start < ? LIMIT ?)`
      )
      .bind(budgetCutoff, batchSize)
      .run();
    const dlq = await database
      .prepare(
        `DELETE FROM tracking_dlq_records WHERE rowid IN (
           SELECT rowid FROM tracking_dlq_records WHERE created_at < ? LIMIT ?)`
      )
      .bind(cutoff, batchSize)
      .run();
    expiredDeliveries += dlq.meta?.changes ?? 0;
    const delivery = await database
      .prepare(
        `DELETE FROM tracking_deliveries WHERE rowid IN (
           SELECT rowid FROM tracking_deliveries
           WHERE updated_at < ? AND state IN ('delivered', 'permanent', 'suppressed') LIMIT ?)`
      )
      .bind(cutoff, batchSize)
      .run();
    expiredDeliveries += delivery.meta?.changes ?? 0;
    await database
      .prepare(
        `DELETE FROM tracking_outbox WHERE rowid IN (
           SELECT rowid FROM tracking_outbox
           WHERE updated_at < ? AND state IN ('delivered', 'permanent', 'suppressed') LIMIT ?)`
      )
      .bind(cutoff, batchSize)
      .run();
    const events = await database
      .prepare(
        `DELETE FROM tracking_events WHERE rowid IN (
           SELECT rowid FROM tracking_events AS expired
           WHERE occurred_at < ?
             AND NOT EXISTS (SELECT 1 FROM tracking_deliveries WHERE event_key = expired.event_key)
             AND NOT EXISTS (SELECT 1 FROM tracking_outbox WHERE event_key = expired.event_key)
           LIMIT ?)`
      )
      .bind(cutoff, batchSize)
      .run();
    expiredEvents = events.meta?.changes ?? 0;
  } catch (error) {
    console.warn(redactError(error));
  }
  return { expiredEvents, expiredDeliveries, watermark: now.toISOString() };
}

export async function recordScheduledMetrics(
  env: Record<string, unknown>,
  startedAt: Date,
  completedAt = new Date()
): Promise<void> {
  const database = env.TRACKING_DB as D1Database | undefined;
  if (!database) return;
  const previous = await database
    .prepare(
      `SELECT metric_value FROM tracking_runtime_metrics
       WHERE metric_key = 'cron_last_completed_at' LIMIT 1`
    )
    .first<{ metric_value: number }>();
  const oldest = await database
    .prepare(
      `SELECT MIN(updated_at) AS oldest FROM tracking_deliveries
       WHERE state NOT IN ('delivered', 'permanent', 'suppressed')`
    )
    .first<{ oldest: string | null }>();
  const completedSeconds = Math.floor(completedAt.getTime() / 1000);
  const oldestAge = oldest?.oldest
    ? Math.max(0, Math.floor((completedAt.getTime() - Date.parse(oldest.oldest)) / 1000))
    : 0;
  const missed =
    previous && previous.metric_value < Math.floor(startedAt.getTime() / 1000) - 120 ? 1 : 0;
  const observedAt = completedAt.toISOString();
  const metric = (key: string, value: number) =>
    database
      .prepare(
        `INSERT INTO tracking_runtime_metrics
         (metric_key, metric_value, observed_at, details_json) VALUES (?, ?, ?, '{}')
         ON CONFLICT(metric_key) DO UPDATE SET metric_value = excluded.metric_value,
           observed_at = excluded.observed_at, details_json = excluded.details_json`
      )
      .bind(key, value, observedAt);
  const results = await database.batch([
    metric('cleanup_watermark_ms', completedAt.getTime()),
    metric('cron_last_completed_at', completedSeconds),
    metric('cron_missed', missed),
    metric('oldest_unresolved_age_seconds', oldestAge),
  ]);
  if (results.some((result) => !result.success)) throw new Error('scheduled_metrics_write_failed');
}

export async function reclaimExpiredLeases(
  env: Record<string, unknown>,
  now = new Date()
): Promise<number> {
  const database = env.TRACKING_DB as D1Database | undefined;
  if (!database) return 0;
  const timestamp = now.toISOString();
  try {
    const result = await database
      .prepare(
        `UPDATE tracking_deliveries
         SET state = 'retryable', lease_until = NULL, lease_deadline = NULL,
           lease_owner = NULL, updated_at = ?
         WHERE state = 'sending' AND lease_deadline IS NOT NULL AND lease_deadline < ?`
      )
      .bind(timestamp, timestamp)
      .run();
    return result.meta?.changes ?? 0;
  } catch (error) {
    console.warn(redactError(error));
    return 0;
  }
}
