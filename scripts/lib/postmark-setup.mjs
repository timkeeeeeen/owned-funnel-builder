export function postmarkTemplates() {
  return [
    {
      Name: 'Purchase access',
      Alias: 'purchase-access',
      TemplateType: 'Standard',
      Subject: '{{delivery_subject}}',
      TextBody:
        '{{delivery_body}}\n\nOpen your purchase: {{access_url}}\n\nNeed help? {{support_email}}',
      HtmlBody:
        '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#111827"><p style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#2563eb">Purchase access</p><h1 style="font-size:32px;line-height:1.1">{{product_name}}</h1><p style="font-size:18px;line-height:1.6;color:#4b5563">{{delivery_body}}</p><p style="margin:28px 0"><a href="{{access_url}}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-size:18px;font-weight:700;padding:16px 22px;border-radius:12px">Open your purchase</a></p><p style="font-size:14px;color:#6b7280">Need help? Reply to this email or contact {{support_email}}.</p></div>',
    },
    {
      Name: 'Simple broadcast',
      Alias: 'simple-broadcast',
      TemplateType: 'Standard',
      Subject: '{{subject}}',
      TextBody:
        '{{text_body}}\n\nUnsubscribe: {{unsubscribe_url}}\n{{sender_name}} · {{postal_address}}',
      HtmlBody:
        '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#111827"><div style="display:none;max-height:0;overflow:hidden">{{preheader}}</div>{{{html_body}}}<hr style="border:0;border-top:1px solid #e5e7eb;margin:32px 0"><p style="font-size:12px;line-height:1.6;color:#6b7280">You opted in to updates from {{sender_name}}.<br><a href="{{unsubscribe_url}}">Unsubscribe</a> · {{postal_address}}</p></div>',
    },
  ];
}

export function postmarkWebhookDefinitions({ siteUrl, username, password }) {
  const definition = (messageStream) => ({
    Url: `${new URL(siteUrl).origin}/api/webhooks/postmark`,
    MessageStream: messageStream,
    HttpAuth: { Username: username, Password: password },
    Triggers: {
      Delivery: { Enabled: true },
      Bounce: { Enabled: true, IncludeContent: false },
      SpamComplaint: { Enabled: true, IncludeContent: false },
      SubscriptionChange: { Enabled: true },
      Open: { Enabled: false, PostFirstOpenOnly: true },
      Click: { Enabled: false },
    },
  });
  return [definition('outbound'), definition('broadcast')];
}
