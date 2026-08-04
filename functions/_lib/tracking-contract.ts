export type EventName = 'PageView' | 'Lead' | 'InitiateCheckout' | 'Purchase';
export type SourceSystem = 'pages' | 'app_idea' | 'blueprint' | 'event_worker';
export type DestinationName = 'meta' | 'tinybird';
export type DeliveryState =
  'pending' | 'sending' | 'delivered' | 'retryable' | 'permanent' | 'outcome_unknown';
export type PrivacyPurpose =
  'necessary' | 'analytics' | 'advertising' | 'identity_enrichment' | 'sale_share';

type CommerceContent = { id: string; quantity: number; item_price?: number };
type EventCommerce = {
  PageView: Record<never, never>;
  Lead: {
    offer_id?: string;
    product_id?: string;
    content_id?: string;
    content_name?: string;
    content_ids?: string[];
    content_type?: string;
    quantity?: number;
    value?: number;
    currency?: string;
    num_items?: number;
    contents?: CommerceContent[];
  };
  InitiateCheckout: {
    offer_id?: string;
    product_id?: string;
    content_ids?: string[];
    content_type?: string;
    quantity?: number;
    value?: number;
    currency?: string;
    num_items?: number;
    contents?: CommerceContent[];
  };
  Purchase: {
    order_id?: string;
    payment_id?: string;
    content_ids?: string[];
    content_type?: string;
    quantity?: number;
    value?: number;
    currency?: string;
    num_items?: number;
    contents?: CommerceContent[];
  };
};

type EventEnvelope<Name extends EventName> = {
  schema_version: '1';
  tenant_id: string;
  site_id: string;
  event_id: string;
  event_name: Name;
  source: 'browser' | 'server';
  source_system: SourceSystem;
  context_hash?: string;
  occurred_at: string;
  visitor: Record<string, string>;
  session: Record<string, string>;
  page: Record<string, string>;
  attribution: Record<string, string>;
  identity: Record<string, string>;
  commerce: EventCommerce[Name];
  privacy: Record<string, string | boolean>;
  device?: Record<string, string | number>;
  geo?: Record<string, string>;
};

export type CanonicalEvent =
  | EventEnvelope<'PageView'>
  | EventEnvelope<'Lead'>
  | EventEnvelope<'InitiateCheckout'>
  | EventEnvelope<'Purchase'>;

type MetaContent = CommerceContent;
type MetaCustomData = {
  order_id?: string;
  payment_id?: string;
  content_ids?: string[];
  content_type?: 'product';
  contents?: MetaContent[];
  currency?: string;
  quantity?: number;
  num_items?: number;
  value?: number;
};
type MetaPayload = {
  event_name: EventName;
  event_time: number;
  event_id: string;
  action_source: 'website';
  event_source_url?: string;
  custom_data?: MetaCustomData;
  user_data?: {
    client_ip_address?: string;
    client_user_agent?: string;
    em?: string[];
    external_id?: string[];
    fbc?: string;
    fbp?: string;
    ph?: string[];
  };
};

export type DestinationProjection =
  | {
      destination: 'meta';
      event_name: EventName;
      event_id: string;
      occurred_at: string;
      payload: MetaPayload;
    }
  | {
      destination: 'tinybird';
      event_name: EventName;
      event_id: string;
      occurred_at: string;
      payload: CanonicalEvent;
    };

const eventNames = new Set<EventName>(['PageView', 'Lead', 'InitiateCheckout', 'Purchase']);
const sourceSystems = new Set<SourceSystem>(['pages', 'app_idea', 'blueprint', 'event_worker']);
const sectionKeys = {
  visitor: ['id', 'visitor_id', 'person_id'],
  session: ['id', 'session_id'],
  page: ['path', 'title', 'type', 'referrer_path', 'referring_domain'],
  attribution: [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'fbclid',
    'fbp',
    'fbc',
    'gclid',
    'ttclid',
    'msclkid',
  ],
  identity: [
    'visitor_id',
    'person_id',
    'lead_id',
    'funnel_id',
    'checkout_id',
    'order_id',
    'payment_id',
    'external_id',
  ],
  device: [
    'language',
    'timezone',
    'screen_width',
    'screen_height',
    'viewport_width',
    'viewport_height',
    'user_agent',
  ],
  geo: ['country', 'region', 'city', 'postal_code', 'timezone'],
  privacy: ['notice_version', 'policy_version', 'region', 'gpc', 'opted_out'],
} as const;
const commerceKeys: Record<EventName, readonly string[]> = {
  PageView: [],
  Lead: [
    'offer_id',
    'product_id',
    'content_id',
    'content_name',
    'content_ids',
    'content_type',
    'quantity',
    'value',
    'currency',
    'num_items',
    'contents',
  ],
  InitiateCheckout: [
    'offer_id',
    'product_id',
    'content_ids',
    'content_type',
    'quantity',
    'value',
    'currency',
    'num_items',
    'contents',
  ],
  Purchase: [
    'order_id',
    'payment_id',
    'content_ids',
    'content_type',
    'quantity',
    'value',
    'currency',
    'num_items',
    'contents',
  ],
};

function invalid(message: string): never {
  throw new TypeError(`Invalid canonical event: ${message}`);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function safeString(value: unknown, name: string, maximum = 256, allowPhoneLike = false): string {
  if (typeof value !== 'string' || !value || value.length > maximum)
    invalid(`${name} must be a bounded string`);
  if (
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value) ||
    /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(value)
  )
    invalid(`${name} contains forbidden data`);
  if ((!allowPhoneLike && /\+?\d[\d\s().-]{6,}\d/.test(value)) || /^[A-Za-z0-9_-]{43}$/.test(value))
    invalid(`${name} contains forbidden data`);
  return value;
}

function opaqueId(value: unknown, name: string, maximum = 256): string {
  const candidate = safeString(value, name, maximum, true);
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(candidate))
    invalid(`${name} must be an opaque identifier`);
  return candidate;
}

function allowedObject(
  value: unknown,
  name: keyof typeof sectionKeys,
  types: Record<string, 'string' | 'number' | 'boolean'> = {}
): Record<string, string | number | boolean> {
  const input = record(value, name);
  const allowed = new Set<string>(sectionKeys[name]);
  const output: Record<string, string | number | boolean> = {};
  for (const [key, field] of Object.entries(input)) {
    if (!allowed.has(key) || /(?:email|phone|token|properties)/i.test(key))
      invalid(`${name}.${key} is not allowed`);
    const type = types[key] ?? 'string';
    if (key === 'policy_version') {
      if (typeof field !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(field))
        invalid(`${name}.${key} must be a date-shaped policy version`);
      output[key] = field;
    } else if (type === 'string')
      output[key] =
        key === 'user_agent'
          ? safeString(field, `${name}.${key}`, 512, true)
          : /(?:^|_)(?:id|[a-z]+_id)$/.test(key)
            ? opaqueId(field, `${name}.${key}`)
            : safeString(field, `${name}.${key}`);
    else if (type === 'number' && typeof field === 'number' && Number.isFinite(field))
      output[key] = field;
    else if (type === 'boolean' && typeof field === 'boolean') output[key] = field;
    else invalid(`${name}.${key} must be ${type}`);
  }
  return output;
}

function commerce<Name extends EventName>(value: unknown, eventName: Name): EventCommerce[Name] {
  const input = record(value, 'commerce');
  const allowed = new Set(commerceKeys[eventName]);
  const output: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(input)) {
    if (!allowed.has(key) || /(?:email|phone|token|properties)/i.test(key))
      invalid(`commerce.${key} is not allowed`);
    if (key === 'contents') {
      if (!Array.isArray(field)) invalid('commerce.contents must be an array');
      output.contents = field.map((item) => {
        const content = record(item, 'commerce.contents');
        if (!['id', 'quantity'].every((contentKey) => contentKey in content)) {
          invalid('commerce.contents has invalid keys');
        }
        if (
          Object.keys(content).some(
            (contentKey) => !['id', 'quantity', 'item_price'].includes(contentKey)
          )
        ) {
          invalid('commerce.contents has invalid keys');
        }
        if (
          typeof content.quantity !== 'number' ||
          !Number.isInteger(content.quantity) ||
          content.quantity < 0 ||
          (content.item_price !== undefined &&
            (typeof content.item_price !== 'number' ||
              !Number.isFinite(content.item_price) ||
              content.item_price < 0))
        ) {
          invalid('commerce.contents has invalid values');
        }
        return {
          id: opaqueId(content.id, 'commerce.contents.id'),
          quantity: content.quantity,
          ...(content.item_price === undefined ? {} : { item_price: content.item_price }),
        };
      });
    } else if (key === 'content_ids') {
      if (!Array.isArray(field)) invalid('commerce.content_ids must be an array');
      output.content_ids = field.map((id) => opaqueId(id, 'commerce.content_ids'));
    } else if (key === 'order_id' || key === 'payment_id' || key === 'content_id') {
      output[key] = opaqueId(field, `commerce.${key}`);
    } else if (key === 'quantity' || key === 'num_items') {
      if (typeof field !== 'number' || !Number.isInteger(field) || field < 0)
        invalid(`commerce.${key} must be a non-negative integer`);
      output[key] = field;
    } else if (key === 'value') {
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0)
        invalid('commerce.value must be a non-negative number');
      output[key] = field;
    } else if (key === 'currency') {
      if (typeof field !== 'string' || !/^[A-Z]{3}$/.test(field))
        invalid('commerce.currency must be an ISO currency code');
      output[key] = field;
    } else if (typeof field === 'number' && Number.isFinite(field)) output[key] = field;
    else output[key] = safeString(field, `commerce.${key}`);
  }
  return output as EventCommerce[Name];
}

export function validateCanonicalEvent(input: unknown): CanonicalEvent {
  const event = record(input, 'event');
  const required = [
    'schema_version',
    'tenant_id',
    'site_id',
    'event_id',
    'event_name',
    'source',
    'source_system',
    'occurred_at',
    'visitor',
    'session',
    'page',
    'attribution',
    'identity',
    'commerce',
    'privacy',
  ];
  const allowed = new Set([...required, 'context_hash', 'device', 'geo']);
  if (Object.keys(event).some((key) => !allowed.has(key))) invalid('contains an unknown field');
  if (required.some((key) => !(key in event))) invalid('is missing a required field');
  if (event.schema_version !== '1') invalid('schema_version must be 1');
  if (!eventNames.has(event.event_name as EventName)) invalid('event_name is not supported');
  if (event.source !== 'browser' && event.source !== 'server') invalid('source is not supported');
  if (!sourceSystems.has(event.source_system as SourceSystem))
    invalid('source_system is not supported');
  if (event.context_hash !== undefined && (typeof event.context_hash !== 'string' || !/^[a-f0-9]{64}$/i.test(event.context_hash)))
    invalid('context_hash must be a SHA-256 hex digest');
  const occurredAt = safeString(event.occurred_at, 'occurred_at', 64, true);
  if (Number.isNaN(Date.parse(occurredAt))) invalid('occurred_at must be an ISO date');
  const event_name = event.event_name as EventName;
  return {
    schema_version: '1',
    tenant_id: opaqueId(event.tenant_id, 'tenant_id', 128),
    site_id: opaqueId(event.site_id, 'site_id', 128),
    event_id: opaqueId(event.event_id, 'event_id', 128),
    event_name,
    source: event.source,
    source_system: event.source_system as SourceSystem,
    ...(event.context_hash === undefined ? {} : { context_hash: event.context_hash }),
    occurred_at: occurredAt,
    visitor: allowedObject(event.visitor, 'visitor') as Record<string, string>,
    session: allowedObject(event.session, 'session') as Record<string, string>,
    page: allowedObject(event.page, 'page') as Record<string, string>,
    attribution: allowedObject(event.attribution, 'attribution') as Record<string, string>,
    identity: allowedObject(event.identity, 'identity') as Record<string, string>,
    commerce: commerce(event.commerce, event_name),
    privacy: allowedObject(event.privacy, 'privacy', {
      gpc: 'boolean',
      opted_out: 'boolean',
    }) as Record<string, string | boolean>,
    ...(event.device === undefined
      ? {}
      : {
          device: allowedObject(event.device, 'device', {
            screen_width: 'number',
            screen_height: 'number',
            viewport_width: 'number',
            viewport_height: 'number',
          }) as Record<string, string | number>,
        }),
    ...(event.geo === undefined
      ? {}
      : { geo: allowedObject(event.geo, 'geo') as Record<string, string> }),
  } as CanonicalEvent;
}

function metaContents(value: unknown): MetaContent[] {
  if (!Array.isArray(value)) invalid('meta.contents must be an array');
  return value.map((item) => {
    const content = record(item, 'meta.contents');
    if (
      !('id' in content) ||
      !('quantity' in content) ||
      Object.keys(content).some((key) => !['id', 'quantity', 'item_price'].includes(key))
    ) {
      invalid('meta.contents has invalid keys');
    }
    if (
      typeof content.quantity !== 'number' ||
      !Number.isInteger(content.quantity) ||
      content.quantity < 0
    ) {
      invalid('meta.contents.quantity must be a non-negative integer');
    }
    if (
      content.item_price !== undefined &&
      (typeof content.item_price !== 'number' ||
        !Number.isFinite(content.item_price) ||
        content.item_price < 0)
    ) {
      invalid('meta.contents.item_price must be a number');
    }
    return {
      id: opaqueId(content.id, 'meta.contents.id'),
      quantity: content.quantity,
      ...(content.item_price === undefined ? {} : { item_price: content.item_price }),
    };
  });
}

function clientIpAddress(value: unknown): string {
  if (typeof value !== 'string') {
    invalid('meta.client_ip_address must be an IP address');
  }
  if (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(value)) {
    return value;
  }
  try {
    new URL(`http://[${value}]/`);
    return value;
  } catch {
    return invalid('meta.client_ip_address must be an IP address');
  }
}

function clientUserAgent(value: unknown): string {
  const userAgent = safeString(value, 'meta.client_user_agent', 512, true);
  if (!/^[A-Za-z][A-Za-z\d .;()/_-]*$/.test(userAgent)) {
    invalid('meta.client_user_agent must be a user agent');
  }
  return userAgent;
}

function metaPayload(value: unknown, occurredAt: string): MetaPayload {
  const input = record(value, 'meta payload');
  const allowed = new Set([
    'event_name',
    'event_time',
    'event_id',
    'action_source',
    'event_source_url',
    'custom_data',
    'user_data',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    invalid('meta payload contains an unknown field');
  if (
    !eventNames.has(input.event_name as EventName) ||
    typeof input.event_time !== 'number' ||
    !Number.isInteger(input.event_time) ||
    input.event_time < 0 ||
    input.action_source !== 'website'
  ) {
    invalid('meta payload has invalid required fields');
  }
  if (Math.abs(input.event_time * 1000 - Date.parse(occurredAt)) > 300_000)
    invalid('meta event_time does not match occurred_at');
  const output: MetaPayload = {
    event_name: input.event_name as EventName,
    event_time: input.event_time,
    event_id: opaqueId(input.event_id, 'meta.event_id', 128),
    action_source: 'website',
  };
  if (input.event_source_url !== undefined) {
    if (
      typeof input.event_source_url !== 'string' ||
      !input.event_source_url ||
      input.event_source_url.length > 512
    )
      invalid('meta.event_source_url must be a bounded URL');
    const sourceUrl = input.event_source_url;
    try {
      const url = new URL(sourceUrl);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'shop.maestrogtm.com' ||
        url.search ||
        url.hash
      )
        invalid('meta.event_source_url must use the trusted HTTPS host');
      output.event_source_url = sourceUrl;
    } catch {
      invalid('meta.event_source_url must be a URL');
    }
  }
  if (input.custom_data !== undefined) {
    const custom = record(input.custom_data, 'meta.custom_data');
    const allowedCustom = new Set(
      input.event_name === 'PageView'
        ? []
        : input.event_name === 'Purchase'
          ? ['order_id', 'payment_id', 'content_ids', 'content_type', 'contents', 'currency', 'quantity', 'num_items', 'value']
          : ['content_ids', 'content_type', 'contents', 'currency', 'quantity', 'num_items', 'value']
    );
    if (Object.keys(custom).some((key) => !allowedCustom.has(key)))
      invalid('meta.custom_data contains an unknown field');
    output.custom_data = {
      ...(custom.order_id === undefined
        ? {}
        : { order_id: opaqueId(custom.order_id, 'meta.order_id') }),
      ...(custom.payment_id === undefined
        ? {}
        : { payment_id: opaqueId(custom.payment_id, 'meta.payment_id') }),
      ...(custom.content_ids === undefined
        ? {}
        : {
            content_ids: Array.isArray(custom.content_ids)
              ? custom.content_ids.map((id) => opaqueId(id, 'meta.content_ids'))
              : invalid('meta.content_ids must be an array'),
          }),
      ...(custom.content_type === undefined
        ? {}
        : {
            content_type:
              custom.content_type === 'product'
                ? 'product'
                : invalid('meta.content_type must be product'),
          }),
      ...(custom.contents === undefined ? {} : { contents: metaContents(custom.contents) }),
      ...(custom.currency === undefined
        ? {}
        : {
            currency:
              typeof custom.currency === 'string' && /^[A-Z]{3}$/.test(custom.currency)
                ? custom.currency
                : invalid('meta.currency must be an ISO currency code'),
          }),
      ...(custom.quantity === undefined
        ? {}
        : {
            quantity:
              typeof custom.quantity === 'number' &&
              Number.isInteger(custom.quantity) &&
              custom.quantity >= 0
                ? custom.quantity
                : invalid('meta.quantity must be a non-negative integer'),
          }),
      ...(custom.num_items === undefined
        ? {}
        : {
            num_items:
              typeof custom.num_items === 'number' &&
              Number.isInteger(custom.num_items) &&
              custom.num_items >= 0
                ? custom.num_items
                : invalid('meta.num_items must be a non-negative integer'),
          }),
      ...(custom.value === undefined
        ? {}
        : {
            value:
              typeof custom.value === 'number' && Number.isFinite(custom.value) && custom.value > 0
                ? custom.value
                : invalid('meta.value must be a positive number'),
          }),
    };
  }
  if (input.user_data !== undefined) {
    const user = record(input.user_data, 'meta.user_data');
    const allowedUser = new Set([
      'client_ip_address',
      'client_user_agent',
      'em',
      'external_id',
      'fbc',
      'fbp',
      'ph',
    ]);
    if (Object.keys(user).some((key) => !allowedUser.has(key)))
      invalid('meta.user_data contains an unknown field');
    const hashes = (field: unknown, name: string): string[] => {
      if (
        !Array.isArray(field) ||
        field.some((value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value))
      )
        invalid(`${name} must be SHA-256 hashes`);
      return field as string[];
    };
    output.user_data = {
      ...(user.client_ip_address === undefined
        ? {}
        : {
            client_ip_address: clientIpAddress(user.client_ip_address),
          }),
      ...(user.client_user_agent === undefined
        ? {}
        : {
            client_user_agent: clientUserAgent(user.client_user_agent),
          }),
      ...(user.em === undefined ? {} : { em: hashes(user.em, 'meta.em') }),
      ...(user.external_id === undefined
        ? {}
        : { external_id: hashes(user.external_id, 'meta.external_id') }),
      ...(user.fbc === undefined ? {} : { fbc: safeString(user.fbc, 'meta.fbc') }),
      ...(user.fbp === undefined ? {} : { fbp: safeString(user.fbp, 'meta.fbp') }),
      ...(user.ph === undefined ? {} : { ph: hashes(user.ph, 'meta.ph') }),
    };
  }
  return output;
}

export function validateDestinationProjection(input: unknown): DestinationProjection {
  const projection = record(input, 'destination projection');
  if (
    Object.keys(projection).some(
      (key) => !['destination', 'event_name', 'event_id', 'occurred_at', 'payload'].includes(key)
    )
  )
    invalid('destination projection contains an unknown field');
  if (!eventNames.has(projection.event_name as EventName))
    invalid('destination projection has an invalid event_name');
  const event_name = projection.event_name as EventName;
  const event_id = opaqueId(projection.event_id, 'destination event_id', 128);
  const occurred_at = safeString(projection.occurred_at, 'destination occurred_at', 64, true);
  if (Number.isNaN(Date.parse(occurred_at))) invalid('destination occurred_at must be an ISO date');
  if (projection.destination === 'meta') {
    const payload = metaPayload(projection.payload, occurred_at);
    if (payload.event_name !== event_name || payload.event_id !== event_id)
      invalid('meta payload does not match its envelope');
    return { destination: 'meta', event_name, event_id, occurred_at, payload };
  }
  if (projection.destination === 'tinybird') {
    const payload = validateCanonicalEvent(projection.payload);
    if (
      payload.event_name !== event_name ||
      payload.event_id !== event_id ||
      payload.occurred_at !== occurred_at
    )
      invalid('tinybird payload does not match its envelope');
    return { destination: 'tinybird', event_name, event_id, occurred_at, payload };
  }
  return invalid('destination is not supported');
}
