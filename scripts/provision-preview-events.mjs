const args = new Set(process.argv.slice(2));
const environment = args.has('--environment') ? process.argv[process.argv.indexOf('--environment') + 1] : '';
const approvalId = args.has('--approval-id') ? process.argv[process.argv.indexOf('--approval-id') + 1] : '';
const sha = args.has('--sha') ? process.argv[process.argv.indexOf('--sha') + 1] : '';
const execute = args.has('--execute');
if (environment !== 'preview') throw new Error('preview provisioning requires --environment preview');
if (execute && (!approvalId || !/^[a-f0-9]{40,64}$/i.test(sha))) throw new Error('--execute requires --approval-id and exact --sha');
if (execute) throw new Error('provisioning blocked: resource and CI readbacks are unverified');
console.log(JSON.stringify({ action: 'preview_provision', environment, mode: 'dry-run', mutations: false }));
