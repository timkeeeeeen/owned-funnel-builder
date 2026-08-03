import { createPostmarkEmailProvider, PostmarkEmailError } from '../../_lib/email';
import { createUnsubscribeToken } from '../../_lib/emailTokens';
import { cleanString, json, readEnvironmentValue, type PagesContext } from '../../_lib/runtime';

type CampaignRequest = {
  action?: unknown;
  campaignId?: unknown;
  offerSlug?: unknown;
  subject?: unknown;
  preheader?: unknown;
  textBody?: unknown;
  htmlBody?: unknown;
};

type Subscriber = { id: string; email: string };
type StoredCampaign = {
  id: string;
  subject: string;
  preheader: string;
  text_body: string;
  html_body: string;
};

const authorized = (context: PagesContext): boolean => {
  const secret = readEnvironmentValue(context.env, 'EMAIL_OPERATOR_SECRET');
  return Boolean(secret) && context.request.headers.get('authorization') === `Bearer ${secret}`;
};

export async function onRequestPost(context: PagesContext): Promise<Response> {
  if (!authorized(context)) return json({ error: 'Unauthorized.' }, 401);
  if (!context.env.LEADS) return json({ error: 'Email campaigns are not configured.' }, 503);
  const database = context.env.LEADS;

  let input: CampaignRequest;
  try {
    input = (await context.request.json()) as CampaignRequest;
  } catch {
    return json({ error: 'Campaign request is invalid.' }, 400);
  }
  const action = cleanString(input.action, 20);
  const requestedCampaignId = cleanString(input.campaignId, 80);
  const offerSlug = cleanString(input.offerSlug, 80);
  let subject = cleanString(input.subject, 160);
  let preheader = cleanString(input.preheader, 240);
  let textBody = cleanString(input.textBody, 50_000);
  let htmlBody = cleanString(input.htmlBody, 100_000);
  if (!['preview', 'send', 'retry'].includes(action)) {
    return json({ error: 'Campaign action is invalid.' }, 400);
  }
  if (action !== 'retry' && (!subject || !textBody || !htmlBody)) {
    return json({ error: 'Subject, plain text, and HTML are required.' }, 400);
  }
  if (action === 'retry' && !/^[A-Za-z0-9-]{1,80}$/.test(requestedCampaignId)) {
    return json({ error: 'Campaign id is invalid.' }, 400);
  }
  if (offerSlug && !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(offerSlug)) {
    return json({ error: 'Offer filter is invalid.' }, 400);
  }

  let campaignId = requestedCampaignId;
  let audience: { results?: Subscriber[] };
  if (action === 'retry') {
    const stored = await context.env.LEADS.prepare(
      `SELECT id, subject, preheader, text_body, html_body
       FROM email_campaigns WHERE id = ?`
    )
      .bind(campaignId)
      .first<StoredCampaign>();
    if (!stored) return json({ error: 'Campaign was not found.' }, 404);
    subject = stored.subject;
    preheader = stored.preheader;
    textBody = stored.text_body;
    htmlBody = stored.html_body;
    audience = await context.env.LEADS.prepare(
      `SELECT s.id, s.email
       FROM email_campaign_recipients AS r
       JOIN email_subscribers AS s ON s.id = r.subscriber_id
       WHERE r.campaign_id = ?
         AND r.status = 'transient_failure'
         AND s.status = 'subscribed'
         AND NOT EXISTS (
           SELECT 1 FROM email_suppressions AS x WHERE x.email = s.email
         )
       ORDER BY r.updated_at ASC
       LIMIT 501`
    )
      .bind(campaignId)
      .all<Subscriber>();
  } else {
    audience = await context.env.LEADS.prepare(
      `SELECT s.id, s.email
       FROM email_subscribers AS s
       WHERE s.status = 'subscribed'
         AND (? = '' OR s.offer_slug = ?)
         AND (
           ? <> '' OR s.id = (
             SELECT latest_consent.id
             FROM email_subscribers AS latest_consent
             WHERE latest_consent.email = s.email AND latest_consent.status = 'subscribed'
             ORDER BY latest_consent.consented_at DESC, latest_consent.id DESC
             LIMIT 1
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM email_suppressions AS x WHERE x.email = s.email
         )
       ORDER BY s.consented_at DESC
       LIMIT 501`
    )
      .bind(offerSlug, offerSlug, offerSlug)
      .all<Subscriber>();
  }
  const rows = audience.results ?? [];
  if (action === 'preview') {
    return json({ eligibleRecipients: Math.min(rows.length, 500), capped: rows.length > 500 });
  }
  if (rows.length === 0) return json({ error: 'No eligible subscribers matched.' }, 409);

  const token = readEnvironmentValue(context.env, 'POSTMARK_SERVER_TOKEN');
  const transactionalFrom = readEnvironmentValue(context.env, 'EMAIL_TRANSACTIONAL_FROM');
  const marketingFrom = readEnvironmentValue(context.env, 'EMAIL_MARKETING_FROM');
  const replyTo = readEnvironmentValue(context.env, 'EMAIL_REPLY_TO');
  const senderName = readEnvironmentValue(context.env, 'EMAIL_SENDER_NAME');
  const postalAddress = readEnvironmentValue(context.env, 'EMAIL_POSTAL_ADDRESS');
  const unsubscribeSecret = readEnvironmentValue(context.env, 'EMAIL_UNSUBSCRIBE_SECRET');
  const publicSiteUrl = readEnvironmentValue(context.env, 'PUBLIC_SITE_URL');
  if (
    !token ||
    !transactionalFrom ||
    !marketingFrom ||
    !replyTo ||
    !senderName ||
    !postalAddress ||
    !unsubscribeSecret ||
    !publicSiteUrl
  ) {
    return json({ error: 'Email campaigns are not fully configured.' }, 503);
  }

  campaignId = action === 'retry' ? campaignId : crypto.randomUUID();
  const now = new Date().toISOString();
  let recipients = rows.slice(0, 500);
  if (action !== 'retry')
    await context.env.LEADS.prepare(
      `INSERT INTO email_campaigns (
      id, offer_slug, subject, preheader, text_body, html_body, status,
      recipient_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sending', ?, ?, ?)`
    )
      .bind(
        campaignId,
        offerSlug || null,
        subject,
        preheader,
        textBody,
        htmlBody,
        recipients.length,
        now,
        now
      )
      .run();

  if (action !== 'retry')
    for (const subscriber of recipients) {
      await context.env.LEADS.prepare(
        `INSERT INTO email_campaign_recipients (
        id, campaign_id, subscriber_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?)`
      )
        .bind(crypto.randomUUID(), campaignId, subscriber.id, now, now)
        .run();
    }

  const provider = createPostmarkEmailProvider({
    token,
    transactionalFrom,
    marketingFrom,
    replyTo,
  });
  const finalAudience = await database.prepare(
    `SELECT s.id, s.email
     FROM email_campaign_recipients AS r
     JOIN email_subscribers AS s ON s.id = r.subscriber_id
     WHERE r.campaign_id = ?
       AND r.status = ?
       AND s.status = 'subscribed'
       AND NOT EXISTS (
         SELECT 1 FROM email_suppressions AS x WHERE x.email = s.email
       )`
  )
    .bind(campaignId, action === 'retry' ? 'transient_failure' : 'pending')
    .all<Subscriber>();
  const eligibleRecipients = finalAudience.results ?? [];
  const eligibleIds = new Set(eligibleRecipients.map((subscriber) => subscriber.id));
  for (const subscriber of recipients) {
    if (eligibleIds.has(subscriber.id)) continue;
    await database.prepare(
      `UPDATE email_campaign_recipients
       SET status = 'permanent_failure', error_code = 'suppressed_before_send',
         error_message = 'Recipient was suppressed before delivery.', updated_at = ?
       WHERE campaign_id = ? AND subscriber_id = ?`
    )
      .bind(new Date().toISOString(), campaignId, subscriber.id)
      .run();
  }
  recipients = eligibleRecipients;
  const updateCampaignStatus = async () => {
    await database.prepare(
      `UPDATE email_campaigns
       SET status = CASE
         WHEN EXISTS (
           SELECT 1 FROM email_campaign_recipients
           WHERE campaign_id = ? AND status IN ('pending', 'transient_failure')
         ) THEN 'partial'
         WHEN EXISTS (
           SELECT 1 FROM email_campaign_recipients
           WHERE campaign_id = ? AND status = 'permanent_failure'
         ) THEN 'partial'
         ELSE 'sent'
       END,
       updated_at = ?
       WHERE id = ?`
    )
      .bind(campaignId, campaignId, new Date().toISOString(), campaignId)
      .run();
  };
  const origin = new URL(publicSiteUrl).origin;
  const messages = await Promise.all(
    recipients.map(async (subscriber) => ({
      recipientKey: subscriber.id,
      to: subscriber.email,
      templateAlias: 'simple-broadcast',
      templateModel: {
        subject,
        preheader,
        text_body: textBody,
        html_body: htmlBody,
        sender_name: senderName,
        postal_address: postalAddress,
      },
      campaignId,
      unsubscribeUrl: `${origin}/api/email/unsubscribe?token=${encodeURIComponent(
        await createUnsubscribeToken({ subscriberId: subscriber.id, secret: unsubscribeSecret })
      )}`,
    }))
  );
  let results;
  try {
    results = await provider.sendBroadcast(messages);
  } catch (error) {
    const retryable = error instanceof PostmarkEmailError && error.retryable;
    const status = retryable ? 'transient_failure' : 'permanent_failure';
    const errorCode = error instanceof PostmarkEmailError ? error.status : 'batch_error';
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Postmark batch failed.';
    for (const subscriber of recipients) {
      await database.prepare(
        `UPDATE email_campaign_recipients
         SET status = ?, provider_message_id = NULL, error_code = ?, error_message = ?, updated_at = ?
         WHERE campaign_id = ? AND subscriber_id = ?`
      )
        .bind(status, errorCode, message, new Date().toISOString(), campaignId, subscriber.id)
        .run();
    }
    await updateCampaignStatus();
    return json(
      { error: 'Postmark batch delivery failed.', campaignId, retryable },
      retryable ? 503 : 502
    );
  }
  let accepted = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === 'accepted') accepted += 1;
    else failed += 1;
    await context.env.LEADS.prepare(
      `UPDATE email_campaign_recipients
       SET status = ?, provider_message_id = ?, error_code = ?, error_message = ?, updated_at = ?
       WHERE campaign_id = ? AND subscriber_id = ?`
    )
      .bind(
        result.status,
        result.status === 'accepted' ? result.messageId : null,
        result.status === 'accepted' ? null : result.errorCode,
        result.status === 'accepted' ? null : result.message,
        new Date().toISOString(),
        campaignId,
        result.recipientKey
      )
      .run();
  }
  await updateCampaignStatus();
  return json({ campaignId, accepted, failed, capped: rows.length > 500 });
}

export function onRequest(): Response {
  return json({ error: 'Method not allowed.' }, 405);
}
