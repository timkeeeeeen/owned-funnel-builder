import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blueprintProgressStepStates,
  isBlueprintProgressStalled,
  latestProgressEvent,
  mergeBlueprintProgress,
  parseBlueprintProgress,
} from '../../src/scripts/blueprint-progress.ts';

const accepted = {
  startedAt: 100,
  lastActivityAt: 120,
  stallAfterMs: 120_000,
  sourceCounts: { profiles: 0, posts: 0, total: 0, truncated: false },
  events: [
    {
      key: 'accepted',
      occurredAt: 100,
      summary: 'Snapshot request accepted.',
      previews: [],
    },
  ],
};

test('parses only the redacted public progress contract', () => {
  const parsed = parseBlueprintProgress({
    ...accepted,
    secret: 'discard me',
    events: [{ ...accepted.events[0], rawBody: 'discard me' }],
  });
  assert.deepEqual(parsed, accepted);
});

test('ignores unknown events without rejecting valid progress', () => {
  const parsed = parseBlueprintProgress({
    ...accepted,
    events: [
      ...accepted.events,
      { key: 'future_stage', occurredAt: 130, summary: 'Future.', previews: [] },
    ],
  });
  assert.deepEqual(
    parsed?.events.map((event) => event.key),
    ['accepted']
  );
});

test('merges sparse responses without regressing reached milestones', () => {
  const research = parseBlueprintProgress({
    ...accepted,
    lastActivityAt: 200,
    events: [
      ...accepted.events,
      {
        key: 'research_started',
        occurredAt: 200,
        summary: 'Research started.',
        previews: [],
      },
    ],
  });
  const merged = mergeBlueprintProgress(research!, parseBlueprintProgress(accepted)!);
  assert.equal(latestProgressEvent(merged)?.key, 'research_started');
  assert.equal(merged.lastActivityAt, 200);
});

test('uses the server stall threshold against the last verified activity', () => {
  const progress = parseBlueprintProgress(accepted)!;
  assert.equal(isBlueprintProgressStalled(progress, 120_119), false);
  assert.equal(isBlueprintProgressStalled(progress, 120_120), true);
});

test('never marks a milestone complete without its own persisted receipt', () => {
  const progress = parseBlueprintProgress({
    ...accepted,
    lastActivityAt: 300,
    events: [
      ...accepted.events,
      {
        key: 'evidence_organized',
        occurredAt: 300,
        summary: 'Public evidence organized for evaluation.',
        previews: [],
      },
    ],
  })!;

  assert.deepEqual(blueprintProgressStepStates(progress), [
    { key: 'accepted', state: 'complete' },
    { key: 'research_started', state: 'pending' },
    { key: 'sources_discovered', state: 'pending' },
    { key: 'evidence_organized', state: 'current' },
    { key: 'dimensions_evaluated', state: 'pending' },
    { key: 'post_drafting', state: 'pending' },
    { key: 'result_finalized', state: 'pending' },
  ]);
});
