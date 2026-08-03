import { verifyUnsubscribeToken } from '../../_lib/emailTokens';
import { cleanString, readEnvironmentValue, type PagesContext } from '../../_lib/runtime';

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const secret = readEnvironmentValue(context.env, 'EMAIL_UNSUBSCRIBE_SECRET');
  const token = cleanString(new URL(context.request.url).searchParams.get('token'), 2048);
  const verified = secret && token ? await verifyUnsubscribeToken({ token, secret }) : null;
  if (!verified) {
    return new Response('This unsubscribe link is invalid or expired.', {
      status: 400,
      headers: responseHeaders,
    });
  }

  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width"><title>Confirm unsubscribe</title><main style="max-width:40rem;margin:10vh auto;padding:2rem;font-family:system-ui"><h1>Confirm unsubscribe</h1><p>Marketing emails will stop. Purchase and account messages are unaffected.</p><form method="post"><button type="submit">Unsubscribe</button></form></main>',
    { status: 200, headers: responseHeaders }
  );
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const database = context.env.LEADS;
  const secret = readEnvironmentValue(context.env, 'EMAIL_UNSUBSCRIBE_SECRET');
  const token = cleanString(new URL(context.request.url).searchParams.get('token'), 2048);
  if (!database || !secret || !token) {
    return new Response('This unsubscribe link is invalid.', {
      status: 400,
      headers: responseHeaders,
    });
  }
  const verified = await verifyUnsubscribeToken({ token, secret });
  if (!verified) {
    return new Response('This unsubscribe link is invalid or expired.', {
      status: 400,
      headers: responseHeaders,
    });
  }
  const subscriber = await database
    .prepare('SELECT email FROM email_subscribers WHERE id = ?')
    .bind(verified.subscriberId)
    .first<{ email: string }>();
  if (!subscriber?.email) {
    return new Response('This email is already unsubscribed.', {
      status: 200,
      headers: responseHeaders,
    });
  }
  const now = new Date().toISOString();
  await database
    .prepare("UPDATE email_subscribers SET status = 'unsubscribed', updated_at = ? WHERE email = ?")
    .bind(now, subscriber.email)
    .run();
  await database
    .prepare(
      `INSERT INTO email_suppressions (email, reason, source, suppressed_at, updated_at)
       VALUES (?, 'unsubscribe', 'link', ?, ?)
       ON CONFLICT(email) DO UPDATE SET reason = 'unsubscribe', source = 'link',
         suppressed_at = excluded.suppressed_at, updated_at = excluded.updated_at
       WHERE email_suppressions.reason = 'unsubscribe'`
    )
    .bind(subscriber.email, now, now)
    .run();
  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width"><title>Unsubscribed</title><main style="max-width:40rem;margin:10vh auto;padding:2rem;font-family:system-ui"><h1>You are unsubscribed.</h1><p>You will not receive future marketing emails. Purchase and account messages are unaffected.</p></main>',
    { status: 200, headers: responseHeaders }
  );
}

export function onRequest(): Response {
  return new Response('Method not allowed.', { status: 405, headers: responseHeaders });
}
