import { previewExecution, PREVIEW_RESOURCES } from './tracking-preview-contract.mjs';

const contract = previewExecution();
if (contract.execute)
  throw new Error('preview resources are provisioned once by an owner-approved operator, not CI');
console.log(
  JSON.stringify({
    action: 'preview_provision',
    environment: 'preview',
    mode: 'dry-run',
    mutations: false,
    resources: PREVIEW_RESOURCES,
  })
);
