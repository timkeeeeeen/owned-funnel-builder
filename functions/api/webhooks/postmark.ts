import { cleanString, json, readEnvironmentValue, type PagesContext } from '../../_lib/runtime';

type PostmarkEvent = {
  RecordType?: unknown;
  Type?: unknown;
  Email?: unknown;
  Recipient?: unknown;
  MessageID?: unknown;
  MessageStream?: unknown;
  BouncedAt?: unknown;
  ChangedAt?: unknown;
  DeliveredAt?: unknown;
  SuppressSending?: unknown;
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const authorized = (context: PagesContext): boolean => {
  const username = readEnvironmentValue(context.env, 'POSTMARK_WEBHOOK_USERNAME');
  const password = readEnvironmentValue(context.env, 'POSTMARK_WEBHOOK_PASSWORD');
  const authorization = context.request.headers.get('authorization') ?? '';
  if (!username || !password || !authorization.startsWith('Basic ')) return false;
  try {
    return atob(authorization.slice(6)) === `${username}:${password}`;
  } catch {
    return false;
  }
};

export async function onRequestPost(context: PagesContext): Promise<Response> {
  if (!authorized(context)) {
    return json({ error: 'Unauthorized.' }, 401);
  }
  if (!context.env.LEADS) return json({ error: 'Email events are not configured.' }, 503);

  let event: PostmarkEvent;
  try {
    event = (await context.request.json()) as PostmarkEvent;
  } catch {
    return json({ error: 'Invalid event.' }, 400);
  }
  const recordType = cleanString(event.RecordType, 80);
  const bounceType = cleanString(event.Type, 80);
  const messageId = cleanString(event.MessageID, 180);
  const messageStream = cleanString(event.MessageStream, 80);
  const email = cleanString(event.Email ?? event.Recipient, 254).toLowerCase();
  const occurredAt =
    cleanString(event.BouncedAt ?? event.ChangedAt ?? event.DeliveredAt, 80) ||
    new Date().toISOString();
  if (!recordType || !email) return json({ error: 'Invalid event.' }, 400);

  const fingerprint = await sha256(
    [
      recordType,
      bounceType,
      messageId,
      messageStream,
      email,
      occurredAt,
      String(event.SuppressSending),
    ].join(':')
  );
  const recipientHash = await sha256(email);
  const inserted = await context.env.LEADS.prepare(
    `INSERT OR IGNORE INTO email_provider_events (
      fingerprint, record_type, message_id, message_stream, recipient_hash, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      fingerprint,
      recordType,
      messageId || null,
      messageStream || null,
      recipientHash,
      occurredAt,
      new Date().toISOString()
    )
    .run();
  if ((inserted.meta?.changes ?? 0) !== 1) return json({ received: true, duplicate: true });

  const shouldSuppress =
    (recordType === 'Bounce' && bounceType === 'HardBounce') ||
    recordType === 'SpamComplaint' ||
    (recordType === 'SubscriptionChange' && event.SuppressSending === true);
  if (shouldSuppress) {
    const reason =
      recordType === 'SpamComplaint'
        ? 'spam_complaint'
        : recordType === 'SubscriptionChange'
          ? 'unsubscribe'
          : 'hard_bounce';
    const now = new Date().toISOString();
    await context.env.LEADS.prepare(
      `INSERT INTO email_suppressions (email, reason, source, suppressed_at, updated_at)
       VALUES (?, ?, 'postmark', ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         reason = CASE
           WHEN excluded.reason = 'unsubscribe' AND reason <> 'unsubscribe' THEN reason
           ELSE excluded.reason
         END,
         source = 'postmark',
         suppressed_at = excluded.suppressed_at, updated_at = excluded.updated_at
       WHERE excluded.reason <> 'unsubscribe' OR email_suppressions.reason = 'unsubscribe'`
    )
      .bind(email, reason, occurredAt, now)
      .run();
    await context.env.LEADS.prepare(
      "UPDATE email_subscribers SET status = 'suppressed', updated_at = ? WHERE email = ?"
    )
      .bind(now, email)
      .run();
  }

  if (recordType === 'Bounce' && bounceType === 'SoftBounce') {
    const now = new Date().toISOString();
    await context.env.LEADS.prepare(
      `UPDATE email_subscribers
       SET soft_bounce_count = soft_bounce_count + 1,
         status = CASE WHEN soft_bounce_count + 1 >= 3 THEN 'suppressed' ELSE status END,
         updated_at = ?
       WHERE email = ?`
    )
      .bind(now, email)
      .run();
    await context.env.LEADS.prepare(
      `INSERT INTO email_suppressions (email, reason, source, suppressed_at, updated_at)
       SELECT ?, 'soft_bounce', 'postmark', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM email_subscribers WHERE email = ? AND soft_bounce_count >= 3
       )
       ON CONFLICT(email) DO UPDATE SET reason = 'soft_bounce', source = 'postmark',
         suppressed_at = excluded.suppressed_at, updated_at = excluded.updated_at
       WHERE email_suppressions.reason = 'soft_bounce'`
    )
      .bind(email, occurredAt, now, email)
      .run();
  }

  return json({ received: true });
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}
