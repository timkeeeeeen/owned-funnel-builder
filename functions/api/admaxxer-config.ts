import { cleanString, json, type PagesContext } from '../_lib/runtime';

const DEFAULT_SCRIPT_URL = 'https://admaxxer.com/js/script.js';

export function onRequestGet({ env }: PagesContext): Response {
  const websiteId = cleanString(env.PUBLIC_ADMAXXER_WEBSITE_ID, 180);
  const domain = cleanString(env.PUBLIC_ADMAXXER_DOMAIN, 253);
  const scriptUrl = cleanString(env.PUBLIC_ADMAXXER_SCRIPT_URL, 500) || DEFAULT_SCRIPT_URL;

  if (!websiteId || !domain) return json({ enabled: false });

  return json({ enabled: true, websiteId, domain, scriptUrl });
}
