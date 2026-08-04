import { handleCollectorFetch, type CollectorEnv, type ExecutionContextLike } from './collector.ts';
import { processQueue, type QueueBatch, type QueueEnv } from './queue.ts';
import { enqueueDueOutbox } from './outbox.ts';
import { reclaimExpiredLeases, recordScheduledMetrics, runCleanup } from './cleanup.ts';
import type { TrackingQueueMessage } from './outbox.ts';
import { assertRuntimeReady } from './safety.ts';
import { jsonResponse } from './observability.ts';

export type EventsEnv = CollectorEnv & QueueEnv;
export type ScheduledLike = { scheduledTime?: number };
export type WorkerMessageBatch = MessageBatchLike;
export type MessageBatchLike = QueueBatch & { queue?: string };
export type WorkerExecutionContext = ExecutionContextLike;

const context = (value: unknown): ExecutionContextLike => value as ExecutionContextLike;

const worker = {
  async fetch(
    request: Request,
    env: EventsEnv,
    executionContext: WorkerExecutionContext
  ): Promise<Response> {
    try {
      await assertRuntimeReady(env);
    } catch {
      return jsonResponse({ error: 'tracking_migrations_not_ready' }, 503);
    }
    return handleCollectorFetch(request, env, context(executionContext));
  },

  async queue(batch: MessageBatchLike, env: EventsEnv): Promise<void> {
    await assertRuntimeReady(env);
    await processQueue(batch, env);
  },

  async scheduled(
    _event: ScheduledLike,
    env: EventsEnv,
    executionContext: WorkerExecutionContext
  ): Promise<void> {
    const run = async () => {
      const startedAt = new Date();
      await assertRuntimeReady(env);
      await reclaimExpiredLeases(env);
      await enqueueDueOutbox(env, 100);
      await runCleanup(env);
      await recordScheduledMetrics(env, startedAt);
    };
    if (executionContext?.waitUntil) executionContext.waitUntil(run());
    else await run();
  },
};

export default worker;
export { handleCollectorFetch } from './collector.ts';
export { processQueue } from './queue.ts';
