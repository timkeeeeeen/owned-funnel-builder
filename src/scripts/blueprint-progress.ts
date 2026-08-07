export const BLUEPRINT_PROGRESS_KEYS = [
  'accepted',
  'research_started',
  'sources_discovered',
  'evidence_organized',
  'dimensions_evaluated',
  'post_drafting',
  'result_finalized',
] as const;

export type BlueprintProgressKey = (typeof BLUEPRINT_PROGRESS_KEYS)[number];
export type BlueprintProgressEventKey = BlueprintProgressKey | 'failed';
export type BlueprintProgressEvent = {
  key: BlueprintProgressEventKey;
  occurredAt: number;
  summary: string;
  previews: Array<{ kind: 'profile' | 'post'; label: string; observedAt: number }>;
};
export type BlueprintProgress = {
  startedAt: number;
  lastActivityAt: number;
  stallAfterMs: number;
  sourceCounts: { profiles: number; posts: number; total: number; truncated: boolean };
  events: BlueprintProgressEvent[];
};

const EVENT_KEYS = new Set<string>([...BLUEPRINT_PROGRESS_KEYS, 'failed']);

export function parseBlueprintProgress(value: unknown): BlueprintProgress | null {
  if (!isRecord(value) || !isRecord(value.sourceCounts) || !Array.isArray(value.events)) {
    return null;
  }
  const startedAt = nonNegativeNumber(value.startedAt);
  const lastActivityAt = nonNegativeNumber(value.lastActivityAt);
  const stallAfterMs = nonNegativeNumber(value.stallAfterMs);
  const profiles = count(value.sourceCounts.profiles);
  const posts = count(value.sourceCounts.posts);
  const total = count(value.sourceCounts.total);
  if (
    startedAt === null ||
    lastActivityAt === null ||
    stallAfterMs === null ||
    stallAfterMs === 0 ||
    profiles === null ||
    posts === null ||
    total === null ||
    typeof value.sourceCounts.truncated !== 'boolean'
  ) {
    return null;
  }

  const events: BlueprintProgressEvent[] = [];
  for (const item of value.events) {
    if (!isRecord(item) || typeof item.key !== 'string') return null;
    if (!EVENT_KEYS.has(item.key)) continue;
    const occurredAt = nonNegativeNumber(item.occurredAt);
    if (occurredAt === null || typeof item.summary !== 'string' || !Array.isArray(item.previews)) {
      return null;
    }
    const previews: BlueprintProgressEvent['previews'] = [];
    for (const value of item.previews.slice(0, 5)) {
      const preview = parsePreview(value);
      if (!preview) return null;
      previews.push(preview);
    }
    events.push({
      key: item.key as BlueprintProgressEventKey,
      occurredAt,
      summary: item.summary,
      previews,
    });
  }

  return {
    startedAt,
    lastActivityAt,
    stallAfterMs,
    sourceCounts: { profiles, posts, total, truncated: value.sourceCounts.truncated },
    events: events.sort((left, right) => left.occurredAt - right.occurredAt),
  };
}

export function mergeBlueprintProgress(
  previous: BlueprintProgress,
  next: BlueprintProgress
): BlueprintProgress {
  const events = new Map(previous.events.map((event) => [event.key, event]));
  for (const event of next.events) {
    const current = events.get(event.key);
    if (!current || event.occurredAt >= current.occurredAt) events.set(event.key, event);
  }
  return {
    startedAt: Math.min(previous.startedAt, next.startedAt),
    lastActivityAt: Math.max(previous.lastActivityAt, next.lastActivityAt),
    stallAfterMs: next.stallAfterMs,
    sourceCounts: {
      profiles: Math.max(previous.sourceCounts.profiles, next.sourceCounts.profiles),
      posts: Math.max(previous.sourceCounts.posts, next.sourceCounts.posts),
      total: Math.max(previous.sourceCounts.total, next.sourceCounts.total),
      truncated: previous.sourceCounts.truncated || next.sourceCounts.truncated,
    },
    events: [...events.values()].sort((left, right) => left.occurredAt - right.occurredAt),
  };
}

export function latestProgressEvent(progress: BlueprintProgress) {
  return progress.events.at(-1) ?? null;
}

export function isBlueprintProgressStalled(progress: BlueprintProgress, now: number) {
  return now - progress.lastActivityAt >= progress.stallAfterMs;
}

function parsePreview(value: unknown): BlueprintProgressEvent['previews'][number] | null {
  if (!isRecord(value) || (value.kind !== 'profile' && value.kind !== 'post')) return null;
  const observedAt = nonNegativeNumber(value.observedAt);
  return typeof value.label === 'string' && observedAt !== null
    ? { kind: value.kind, label: value.label, observedAt }
    : null;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function count(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
