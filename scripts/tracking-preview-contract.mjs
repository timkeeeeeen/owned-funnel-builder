export const PREVIEW_APPROVAL = 'owner-preview-tracking-2026-08-15';
export const PREVIEW_RESOURCES = Object.freeze({
  worker: 'maestro-first-party-events',
  trackingDatabase: 'maestro-tracking-preview',
  pagesDatabase: 'owned-funnel-builder-preview',
  queue: 'maestro-events-preview',
  dlq: 'maestro-events-preview-dlq',
  host: 'events-preview.shop.maestrogtm.com',
});

export function previewExecution(argv = process.argv.slice(2)) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? '' : (argv[index + 1] ?? '');
  };
  const approvalId = value('--approval-id');
  const workerSha = value('--worker-sha') || value('--sha');
  const sourceSha = value('--source-sha');
  const execute = argv.includes('--execute');
  const environment = value('--environment') || (execute ? '' : 'preview');
  if (environment !== 'preview') throw new Error('preview only');
  if (
    execute &&
    (approvalId !== PREVIEW_APPROVAL ||
      !/^[a-f0-9]{40}$/.test(workerSha) ||
      (sourceSha && !/^[a-f0-9]{40}$/.test(sourceSha)))
  )
    throw new Error('--execute requires --approval-id and exact preview SHAs');
  return { approvalId, workerSha, sourceSha, execute };
}
