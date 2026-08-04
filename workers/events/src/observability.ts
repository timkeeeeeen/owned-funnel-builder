const JSON_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

export type AlertInput = {
  oldestUnresolved: number;
  dlqCount: number;
  eventKeys?: string[];
};

/** Deliberately count-only: external probes and alerts must not expose payloads. */
export function alertPayload(input: AlertInput): Record<string, unknown> {
  return {
    oldest_unresolved: Math.max(0, Math.floor(input.oldestUnresolved)),
    dlq_count: Math.max(0, Math.floor(input.dlqCount)),
    event_keys: (input.eventKeys ?? [])
      .filter((value) => /^[A-Za-z0-9:_-]{1,128}$/.test(value))
      .slice(0, 20),
  };
}

export function healthResponse(status: 'ok' | 'degraded' = 'ok'): Response {
  return new Response(JSON.stringify({ status, version: '1' }), {
    status: status === 'ok' ? 200 : 503,
    headers: JSON_HEADERS,
  });
}

export function jsonResponse(
  payload: Record<string, unknown>,
  status = 200,
  headers?: Headers
): Response {
  const merged = new Headers(JSON_HEADERS);
  headers?.forEach((value, key) => merged.set(key, value));
  return new Response(JSON.stringify(payload), { status, headers: merged });
}

export function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown_error';
  return message
    .replace(
      /(?:token|secret|authorization|email|phone|cookie)\s*[:=]\s*[^\s,;]+/gi,
      '$1:[redacted]'
    )
    .slice(0, 256);
}
