import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readLocalSettings, writeLocalSettings } from './lib/local-settings.mjs';

const existing = await readLocalSettings();
const token = randomBytes(24).toString('base64url');

const escapeHtml = (value = '') =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const saved = (key) => (existing[key] ? 'Already saved — leave blank to keep it' : 'Paste it here');
const value = (key, fallback = '') => escapeHtml(existing[key] || fallback);

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Owned Funnel Builder setup</title>
<style>
  :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#111827;background:#eef2ff}*{box-sizing:border-box}
  body{margin:0;padding:32px 16px}.wrap{max-width:760px;margin:auto}.hero{background:#111827;color:white;border-radius:24px;padding:34px;margin-bottom:18px}.hero h1{font-size:clamp(36px,8vw,64px);line-height:.95;letter-spacing:-.05em;margin:12px 0}.hero p{font-size:18px;line-height:1.6;color:#cbd5e1}.tag{font:700 12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.16em;color:#93c5fd}
  form{background:white;border:1px solid #dbe3f0;border-radius:24px;padding:28px;box-shadow:0 20px 60px #1e3a8a1c}.section{padding:22px 0;border-bottom:1px solid #e5e7eb}.section:last-of-type{border:0}.section h2{margin:0 0 6px;font-size:24px}.section>p{margin:0 0 18px;color:#6b7280;line-height:1.5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.full{grid-column:1/-1}label{display:block;font-weight:750;font-size:14px}input,select{width:100%;margin-top:7px;min-height:52px;border:2px solid #d1d5db;border-radius:12px;padding:12px 14px;font:inherit;background:white}input:focus,select:focus{outline:4px solid #bfdbfe;border-color:#2563eb}small{display:block;color:#6b7280;margin-top:6px;line-height:1.4}button{width:100%;min-height:70px;border:0;border-radius:14px;background:#2563eb;color:white;font-size:21px;font-weight:800;margin-top:24px;cursor:pointer}button:hover{background:#1d4ed8}.privacy{text-align:center;color:#6b7280;font-size:13px;line-height:1.5;margin:14px 20px}@media(max-width:640px){.grid{grid-template-columns:1fr}.full{grid-column:auto}.hero,form{padding:22px}}
</style></head><body><div class="wrap">
<div class="hero"><div class="tag">Private setup screen</div><h1>Connect your funnel.</h1><p>Fill this out once. The details stay in this folder on your computer and are excluded from GitHub. Your agent will handle the technical steps after you save.</p></div>
<form method="post" action="/save">
<input type="hidden" name="token" value="${token}">
<div class="section"><h2>Payments</h2><p>Choose Dodo or Stripe. Both support the main checkout, order bump, and saved-card upsells.</p><div class="grid">
<label class="full">Payment service<select name="PAYMENTS_PROVIDER"><option value="dodo" ${existing.PAYMENTS_PROVIDER !== 'stripe' ? 'selected' : ''}>Dodo Payments</option><option value="stripe" ${existing.PAYMENTS_PROVIDER === 'stripe' ? 'selected' : ''}>Stripe</option></select><small>Your agent connects only the service you choose.</small></label>
<label class="full">Dodo API key<input type="password" name="DODO_PAYMENTS_API_KEY" autocomplete="off" placeholder="${saved('DODO_PAYMENTS_API_KEY')}"><small>For Dodo: find this in Dodo Payments → Developer → API keys.</small></label>
<label>Mode<select name="DODO_PAYMENTS_ENVIRONMENT"><option value="test_mode" ${existing.DODO_PAYMENTS_ENVIRONMENT !== 'live_mode' ? 'selected' : ''}>Test mode</option><option value="live_mode" ${existing.DODO_PAYMENTS_ENVIRONMENT === 'live_mode' ? 'selected' : ''}>Live mode</option></select></label>
<label class="full">Stripe secret key<input type="password" name="STRIPE_SECRET_KEY" autocomplete="off" placeholder="${saved('STRIPE_SECRET_KEY')}"><small>For Stripe: find this in Stripe Workbench → API keys. Start with a test key.</small></label>
<label>Stripe mode<select name="STRIPE_PAYMENTS_ENVIRONMENT"><option value="test_mode" ${existing.STRIPE_PAYMENTS_ENVIRONMENT !== 'live_mode' ? 'selected' : ''}>Test mode</option><option value="live_mode" ${existing.STRIPE_PAYMENTS_ENVIRONMENT === 'live_mode' ? 'selected' : ''}>Live mode</option></select></label>
<label class="full">Stripe webhook signing secret<input type="password" name="STRIPE_WEBHOOK_SECRET" autocomplete="off" placeholder="${saved('STRIPE_WEBHOOK_SECRET')}"><small>Usually leave this blank. Your agent creates and saves it automatically. Paste it only when reusing an existing webhook.</small></label>
</div></div>
<div class="section"><h2>Customer access</h2><p>Dodo can deliver files itself. Stripe needs Resend so every successful payment receives the correct access link.</p><div class="grid">
<label class="full">Resend API key<input type="password" name="RESEND_API_KEY" autocomplete="off" placeholder="${saved('RESEND_API_KEY')}"><small>Optional with Dodo; required with Stripe.</small></label>
<label>From email<input type="email" name="RESEND_FROM_EMAIL" value="${value('RESEND_FROM_EMAIL')}" placeholder="access@yourdomain.com"><small>Optional with Dodo; required with Stripe.</small></label>
<label>Support email<input type="email" name="SUPPORT_EMAIL" required value="${value('SUPPORT_EMAIL')}" placeholder="help@yourdomain.com"></label>
</div></div>
<div class="section"><h2>Ad tracking</h2><p>Admaxxer connects visits, leads, and successful payments so you can see which ads made sales. This is optional until you run ads.</p><div class="grid">
<label class="full">Optional Admaxxer API key<input type="password" name="ADMAXXER_API_KEY" autocomplete="off" placeholder="${saved('ADMAXXER_API_KEY')}"><small>Create a workspace key in Admaxxer → Settings → API Keys with Pixel write access. It is used privately by the verified payment webhook.</small></label>
</div></div>
<div class="section"><h2>Your Cloudflare site</h2><p>Choose simple lowercase names. Your agent will create the site and database.</p><div class="grid">
<label>Site name<input name="FUNNEL_CLOUDFLARE_PROJECT" required pattern="[a-z0-9-]+" value="${value('FUNNEL_CLOUDFLARE_PROJECT', 'my-funnel-site')}"></label>
<label>Database name<input name="FUNNEL_D1_DATABASE" required pattern="[a-z0-9-]+" value="${value('FUNNEL_D1_DATABASE', 'my-funnel-orders')}"></label>
</div></div>
<button type="submit">Save my setup securely →</button><p class="privacy">This page only listens on your computer. It never sends these values to this funnel builder or commits them to GitHub.</p>
</form></div></body></html>`;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (
    request.method === 'GET' &&
    url.pathname === '/setup' &&
    url.searchParams.get('token') === token
  ) {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(page);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/save') {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 32 * 1024) {
        response.writeHead(413).end('Setup form is too large.');
        return;
      }
    }
    const form = new URLSearchParams(body);
    if (form.get('token') !== token) {
      response.writeHead(403).end('This setup link is invalid.');
      return;
    }
    const next = { ...existing };
    for (const key of [
      'PAYMENTS_PROVIDER',
      'DODO_PAYMENTS_API_KEY',
      'DODO_PAYMENTS_ENVIRONMENT',
      'STRIPE_SECRET_KEY',
      'STRIPE_PAYMENTS_ENVIRONMENT',
      'STRIPE_WEBHOOK_SECRET',
      'RESEND_API_KEY',
      'RESEND_FROM_EMAIL',
      'SUPPORT_EMAIL',
      'ADMAXXER_API_KEY',
      'FUNNEL_CLOUDFLARE_PROJECT',
      'FUNNEL_D1_DATABASE',
    ]) {
      const submitted = (form.get(key) ?? '').trim();
      if (submitted) next[key] = submitted;
    }
    next.PUBLIC_SITE_URL = `https://${next.FUNNEL_CLOUDFLARE_PROJECT}.pages.dev`;
    await writeLocalSettings(next);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(
      `<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;background:#eef2ff;padding:40px"><main style="max-width:650px;margin:auto;background:white;padding:40px;border-radius:24px;text-align:center"><div style="font-size:56px">✓</div><h1 style="font-size:38px">Setup saved.</h1><p style="font-size:18px;line-height:1.6;color:#4b5563">You can close this tab and tell your agent: <strong>“My setup is saved. Please finish connecting and publishing my funnel.”</strong></p></main></body>`
    );
    setTimeout(() => server.close(), 1000);
    return;
  }
  response.writeHead(404).end('Not found');
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not open setup.');
  console.log(
    `Open this private setup screen: http://127.0.0.1:${address.port}/setup?token=${token}`
  );
});
