export function corsHeaders(origin: string | null, allowedOrigin: string): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  if (origin !== allowedOrigin) return headers;
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
  return headers;
}
