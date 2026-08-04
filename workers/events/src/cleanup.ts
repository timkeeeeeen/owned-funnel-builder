import type { D1Database } from '../../../functions/_lib/runtime.ts';
import { redactError } from './observability.ts';

export type CleanupResult = { expiredEvents: number; expiredDeliveries: number; watermark: string };

function numberEnv(env: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 3650) : fallback;
}

export async function runCleanup(
  env: Record<string, unknown>,
  now = new Date()
): Promise<CleanupResult> {
  const database = env.TRACKING_DB as D1Database | undefined;
  if (!database) return { expiredEvents: 0, expiredDeliveries: 0, watermark: now.toISOString() };
  const retentionDays = numberEnv(env, 'TRACKING_RETENTION_DAYS', 395);
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  let expiredEvents = 0;
  let expiredDeliveries = 0;
  try {
    await database
      .prepare(`DELETE FROM tracking_nonces WHERE expires_at < ?`)
      .bind(now.toISOString())
      .run();
    const dlq = await database
      .prepare(`DELETE FROM tracking_dlq_records WHERE created_at < ?`)
      .bind(cutoff)
      .run();
    expiredDeliveries += dlq.meta?.changes ?? 0;
    const delivery = await database
      .prepare(
        `DELETE FROM tracking_deliveries
         WHERE updated_at < ? AND state IN ('delivered', 'permanent')`
      )
      .bind(cutoff)
      .run();
    expiredDeliveries = delivery.meta?.changes ?? 0;
    await database
      .prepare(
        `DELETE FROM tracking_outbox
         WHERE updated_at < ? AND state IN ('delivered', 'permanent', 'suppressed')`
      )
      .bind(cutoff)
      .run();
    const events = await database
      .prepare(
        `DELETE FROM tracking_events
         WHERE occurred_at < ?
           AND NOT EXISTS (SELECT 1 FROM tracking_deliveries WHERE event_key = tracking_events.event_key)
           AND NOT EXISTS (SELECT 1 FROM tracking_outbox WHERE event_key = tracking_events.event_key)`
      )
      .bind(cutoff)
      .run();
    expiredEvents = events.meta?.changes ?? 0;
  } catch (error) {
    console.warn(redactError(error));
  }
  return { expiredEvents, expiredDeliveries, watermark: now.toISOString() };
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
         SET state = 'retryable', lease_until = NULL, updated_at = ?
         WHERE state = 'sending' AND lease_until IS NOT NULL AND lease_until < ?`
      )
      .bind(timestamp, timestamp)
      .run();
    return result.meta?.changes ?? 0;
  } catch (error) {
    console.warn(redactError(error));
    return 0;
  }
}
