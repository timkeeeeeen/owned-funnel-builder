import { handleCollectorFetch, type CollectorEnv, type ExecutionContextLike } from './collector.ts';
import { processQueue, type QueueBatch, type QueueEnv } from './queue.ts';
import { enqueueDueOutbox } from './outbox.ts';
import { reclaimExpiredLeases, runCleanup } from './cleanup.ts';
import type { TrackingQueueMessage } from './outbox.ts';

export type EventsEnv = CollectorEnv & QueueEnv;
export type ScheduledLike = { scheduledTime?: number };
export type WorkerMessageBatch = MessageBatchLike;
export type MessageBatchLike = QueueBatch & { queue?: string };
export type WorkerExecutionContext = ExecutionContextLike;

const context = (value: unknown): ExecutionContextLike => value as ExecutionContextLike;

const worker = {
  fetch(
    request: Request,
    env: EventsEnv,
    executionContext: WorkerExecutionContext
  ): Promise<Response> {
    return handleCollectorFetch(request, env, context(executionContext));
  },

  async queue(batch: MessageBatchLike, env: EventsEnv): Promise<void> {
    await processQueue(batch, env);
  },

  async scheduled(
    _event: ScheduledLike,
    env: EventsEnv,
    executionContext: WorkerExecutionContext
  ): Promise<void> {
    const run = async () => {
      await reclaimExpiredLeases(env);
      await enqueueDueOutbox(env, 100);
      await runCleanup(env);
    };
    if (executionContext?.waitUntil) executionContext.waitUntil(run());
    else await run();
  },
};

export default worker;
export { handleCollectorFetch } from './collector.ts';
export { processQueue } from './queue.ts';
