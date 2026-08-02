const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

/**
 * @param {{
 *   token?: string;
 *   values?: Record<string, string>;
 *   preview?: {eligibleRecipients: number; capped: boolean};
 *   result?: {accepted: number; failed: number};
 *   error?: string;
 * }} options
 */
export function renderEmailSenderPage({ token, values = {}, preview, result, error } = {}) {
  const field = (name) => escapeHtml(values[name] ?? '');
  const audience = preview
    ? `<div class="notice"><strong>${preview.eligibleRecipients} eligible subscribers</strong>${
        preview.capped ? ' (first 500 will be sent)' : ''
      }</div>`
    : '';
  const completion = result
    ? `<div class="success"><h2>Email sent</h2><p>${result.accepted} accepted, ${result.failed} failed.</p></div>`
    : '';
  const failure = error ? `<div class="error">${escapeHtml(error)}</div>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Send a funnel email</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#111827;background:#eef2ff}*{box-sizing:border-box}body{margin:0;padding:32px 16px}.wrap{max-width:800px;margin:auto}.hero{background:#111827;color:white;border-radius:24px;padding:32px;margin-bottom:18px}.hero h1{font-size:clamp(36px,7vw,58px);line-height:1;margin:8px 0}.hero p{color:#cbd5e1;font-size:18px;line-height:1.5}form{background:white;border-radius:24px;padding:28px;box-shadow:0 20px 60px #1e3a8a1c}label{display:block;font-weight:750;margin:18px 0 0}input,textarea{display:block;width:100%;margin-top:7px;border:2px solid #d1d5db;border-radius:12px;padding:12px 14px;font:inherit}textarea{min-height:130px;font-family:ui-monospace,monospace}button{width:100%;min-height:64px;border:0;border-radius:14px;background:#2563eb;color:white;font-size:20px;font-weight:800;margin-top:22px;cursor:pointer}.notice,.success,.error{padding:18px;border-radius:14px;margin:0 0 18px}.notice{background:#dbeafe}.success{background:#d1fae5}.error{background:#fee2e2;color:#991b1b}.warning{color:#6b7280;font-size:14px;line-height:1.5}
</style></head><body><main class="wrap"><section class="hero"><p>Private local sender</p><h1>Email your opted-in funnel people.</h1><p>Preview the eligible audience, then confirm one simple broadcast.</p></section>${failure}${completion}${audience}
<form method="post" action="${preview ? '/send' : '/preview'}">
<input type="hidden" name="token" value="${escapeHtml(token)}">
${preview ? '<input type="hidden" name="confirmation" value="SEND">' : ''}
<label>Optional offer filter<input name="offerSlug" value="${field('offerSlug')}" placeholder="owned-funnel-builder" pattern="[a-z][a-z0-9-]*"></label>
<label>Subject<input name="subject" required maxlength="160" value="${field('subject')}"></label>
<label>Preview text<input name="preheader" maxlength="240" value="${field('preheader')}"></label>
<label>Plain-text message<textarea name="textBody" required maxlength="50000">${field('textBody')}</textarea></label>
<label>HTML message<textarea name="htmlBody" required maxlength="100000">${field('htmlBody')}</textarea></label>
<p class="warning">Only explicitly opted-in, currently non-suppressed subscribers are eligible. The audience is checked again when you send.</p>
<button type="submit">${preview ? 'Confirm and send' : 'Preview audience'}</button>
</form></main></body></html>`;
}
