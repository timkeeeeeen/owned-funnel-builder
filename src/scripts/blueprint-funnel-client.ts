import {
  blueprintProgressStepStates,
  isBlueprintProgressStalled,
  latestProgressEvent,
  mergeBlueprintProgress,
  parseBlueprintProgress,
  type BlueprintProgress,
} from './blueprint-progress';

type FunnelMode = 'snapshot' | 'direct' | 'thank-you' | 'asset' | 'checkout-return';
type ConvexKind = 'action' | 'query';

type RuntimeConfig = {
  root: HTMLElement;
  mode: FunnelMode;
  audience: string;
  convexUrl: string;
  appUrl: string;
  turnstileSiteKey: string;
  workspaceSlug: string;
  leadMagnetSlug: string;
  thankYouPath: string;
};

type StoredSession = {
  publicSessionToken: string;
  publicSessionExpiresAt: number;
  journeyId: string;
  checkoutIdempotencyKey: string;
  trackingContextToken: string;
  candidateEventId?: string;
};

type SavedSnapshot = {
  score: number;
  maximum: number;
  dimensions: Array<{ key: string; score: number; maximum: number }>;
  findings: Array<{
    dimensionKey: string;
    criterionKey: string;
    reason: string;
    nextLevelCondition: string;
    evidenceRefs: Array<Record<string, unknown>>;
  }>;
  unassessedDimensionKeys: string[];
  post: { title: string; body: string };
  outcome: { outcome: 'ready' | 'strong_starter'; questionsLeft: string[] };
};

type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const START_PATH = 'capabilities/leadMagnets/publicPersonalizations:start';
const WATCH_PATH = 'capabilities/leadMagnets/personalizations:watchPersonalization';
const READ_ASSET_PATH = 'capabilities/leadMagnets/personalizationDelivery:readAsset';
const RETURN_CLAIM_TOKEN_KEY = 'blueprint:return:claim-token';
const ASSET_TOKENS_KEY = 'blueprint:asset:tokens';
const ATTRIBUTION_KEYS = [
  ['utm_source', 'utmSource'],
  ['utm_medium', 'utmMedium'],
  ['utm_campaign', 'utmCampaign'],
  ['utm_content', 'utmContent'],
  ['utm_term', 'utmTerm'],
  ['gclid', 'gclid'],
  ['fbclid', 'fbclid'],
  ['ttclid', 'ttclid'],
  ['msclkid', 'msclkid'],
] as const;

function initializeBlueprintFunnels() {
  document.querySelectorAll<HTMLElement>('[data-blueprint-runtime]').forEach((root) => {
    if (root.dataset.initialized === 'true' || root.dataset.enabled !== 'true') return;
    root.dataset.initialized = 'true';
    const config = readConfig(root);
    if (!config) return;
    void initializeRuntime(config);
  });
}

function readConfig(root: HTMLElement): RuntimeConfig | null {
  const mode = root.dataset.mode;
  const audience = root.dataset.audience ?? '';
  const convexUrl = root.dataset.convexUrl ?? '';
  const appUrl = root.dataset.appUrl ?? '';
  const turnstileSiteKey = root.dataset.turnstileSiteKey ?? '';
  const workspaceSlug = root.dataset.workspaceSlug ?? '';
  const leadMagnetSlug = root.dataset.leadMagnetSlug ?? '';
  if (
    !isMode(mode) ||
    !convexUrl ||
    !appUrl ||
    (requiresAudience(mode) && !audience) ||
    (requiresTurnstile(mode) && !turnstileSiteKey) ||
    !workspaceSlug ||
    !leadMagnetSlug
  ) {
    return null;
  }
  return {
    root,
    mode,
    audience,
    convexUrl,
    appUrl,
    turnstileSiteKey,
    workspaceSlug,
    leadMagnetSlug,
    thankYouPath: root.dataset.thankYouPath ?? '',
  };
}

async function initializeRuntime(config: RuntimeConfig) {
  if (config.mode === 'checkout-return') {
    initializeCheckoutReturn(config);
    return;
  }
  const assetTokens = config.mode === 'asset' ? captureAssetTokens() : null;
  const turnstile = await waitForTurnstile();
  if (!turnstile) {
    setStatus(config, 'The security check could not load. Please reload and try again.');
    return;
  }

  const tokenState = { value: '' };
  const widgetId = renderTurnstile(config, turnstile, tokenState);
  if (config.mode === 'asset') {
    void initializeAsset(
      config,
      tokenState,
      turnstile,
      widgetId,
      assetTokens ?? { deliveryToken: null, claimToken: null }
    );
    return;
  }
  if (config.mode === 'thank-you') {
    initializeThankYou(config, tokenState, turnstile, widgetId);
    return;
  }
  initializeStartForm(config, tokenState, turnstile, widgetId);
}

async function initializeAsset(
  config: RuntimeConfig,
  tokenState: { value: string },
  turnstile: TurnstileApi,
  widgetId: string,
  tokens: { deliveryToken: string | null; claimToken: string | null }
) {
  const action = document.querySelector<HTMLButtonElement>('[data-blueprint-asset-checkout]');
  if (!action || tokens.deliveryToken === null) {
    setStatus(config, 'This saved-result link is incomplete. Open the full link from your email.');
    return;
  }
  try {
    const result = await callConvex(config, 'query', READ_ASSET_PATH, {
      workspaceSlug: config.workspaceSlug,
      routeKey: config.leadMagnetSlug,
      deliveryToken: tokens.deliveryToken,
    });
    if (!isRecord(result) || result.complete !== true || !renderSavedSnapshot(config, result)) {
      setStatus(config, 'This saved result is unavailable or has expired. Contact support.');
      return;
    }
    if (tokens.claimToken === null) {
      setStatus(config, 'Your result is ready. Use the original email if you want to continue.');
      return;
    }
    const claimToken = tokens.claimToken;
    storeReturnClaimToken(claimToken);
    action.dataset.snapshotComplete = 'true';
    action.classList.remove('cursor-not-allowed', 'opacity-60');
    action.disabled = tokenState.value.length === 0;
    action.addEventListener('click', () => {
      void beginCheckoutForSession(config, tokenState, turnstile, widgetId, action, {
        publicSessionToken: claimToken,
        publicSessionExpiresAt: Number.MAX_SAFE_INTEGER,
        journeyId: currentJourneyId(),
        checkoutIdempotencyKey: assetCheckoutIdempotencyKey(claimToken),
        trackingContextToken: '',
      });
    });
    setStatus(config, 'Your saved Snapshot is ready. Complete the security check to continue.');
  } catch {
    setStatus(config, 'We could not open this saved result. Reload once or contact support.');
  }
}

function initializeCheckoutReturn(config: RuntimeConfig) {
  const action = document.querySelector<HTMLAnchorElement>('[data-blueprint-claim-link]');
  const token = readReturnClaimToken();
  if (!action || token === null) {
    setStatus(
      config,
      'Open the delivery email sent to the address used at checkout to continue securely.'
    );
    return;
  }
  const destination = new URL('/blueprint/claim', config.appUrl);
  destination.hash = new URLSearchParams({ claim: token }).toString();
  action.href = destination.toString();
  action.removeAttribute('aria-disabled');
  action.classList.remove('pointer-events-none', 'opacity-60');
  setStatus(
    config,
    'Continue with the same email used at checkout. Maestro will verify payment before importing anything.'
  );
}

function captureAssetTokens() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const deliveryToken = nonEmpty(fragment.get('token'));
  const claimToken = nonEmpty(fragment.get('claim'));
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`
  );
  if (deliveryToken !== null) {
    const tokens = { deliveryToken, claimToken };
    sessionStorage.setItem(ASSET_TOKENS_KEY, JSON.stringify(tokens));
    return tokens;
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(ASSET_TOKENS_KEY) ?? 'null') as unknown;
    if (!isRecord(stored)) return { deliveryToken: null, claimToken: null };
    return {
      deliveryToken: nonEmpty(
        typeof stored.deliveryToken === 'string' ? stored.deliveryToken : null
      ),
      claimToken: nonEmpty(typeof stored.claimToken === 'string' ? stored.claimToken : null),
    };
  } catch {
    return { deliveryToken: null, claimToken: null };
  }
}

function nonEmpty(value: string | null) {
  return value === null || value.trim() === '' ? null : value;
}

function initializeStartForm(
  config: RuntimeConfig,
  tokenState: { value: string },
  turnstile: TurnstileApi,
  widgetId: string
) {
  const form = config.root.closest<HTMLFormElement>('form');
  const action = form?.querySelector<HTMLButtonElement>('[data-blueprint-primary-action]');
  if (!form || !action) return;
  form.querySelectorAll<HTMLInputElement>('input[data-blueprint-input]').forEach((input) => {
    input.disabled = false;
  });
  action.classList.remove('cursor-not-allowed', 'opacity-60');
  if (config.mode === 'snapshot') initializeMobileSnapshotAction(form);

  const existingSession = config.mode === 'direct' ? readSession(config.audience) : null;
  if (existingSession) {
    form.dataset.snapshotStarted = 'true';
    action.disabled = true;
    setStatus(config, 'Restoring your saved Snapshot. Checkout unlocks when it is complete.');
    void watchSnapshot(config, existingSession, () => {
      form.dataset.snapshotComplete = 'true';
      action.dataset.snapshotComplete = 'true';
      action.textContent = 'Continue to secure checkout — $5';
      action.disabled = tokenState.value.length === 0;
      setStatus(config, 'Your Snapshot is saved. Complete the security check to continue.');
    }).catch(() => {
      setStatus(config, 'We could not restore this Snapshot. Reload once or start again.');
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.dataset.snapshotComplete === 'true') {
      void beginCheckout(config, tokenState, turnstile, widgetId, action);
      return;
    }
    if (!form.reportValidity() || !tokenState.value) {
      setStatus(config, 'Complete both fields and the security check to continue.');
      return;
    }
    void startSnapshot(config, form, action, tokenState, turnstile, widgetId);
  });
}

async function startSnapshot(
  config: RuntimeConfig,
  form: HTMLFormElement,
  action: HTMLButtonElement,
  tokenState: { value: string },
  turnstile: TurnstileApi,
  widgetId: string
) {
  action.disabled = true;
  setStatus(config, 'Starting your Authority Snapshot…');
  const formData = new FormData(form);
  const journeyId = currentJourneyId();
  try {
    const result = await callConvex(config, 'action', START_PATH, {
      contractVersion: 'v2',
      workspaceSlug: config.workspaceSlug,
      leadMagnetSlug: config.leadMagnetSlug,
      idempotencyKey: sessionIdempotencyKey(config.audience),
      turnstileToken: tokenState.value,
      lead: {
        linkedinProfileUrl: String(formData.get('linkedin') ?? ''),
        email: String(formData.get('email') ?? ''),
      },
      acquisition: {
        entry: config.mode === 'direct' ? 'cmo-game-plan-direct' : 'authority-snapshot',
        audience: config.audience,
        journeyId,
        attribution: readAttribution(),
      },
    });
    const session = parseStartResult(result, journeyId);
    storeSession(config.audience, session);
    tokenState.value = '';
    turnstile.reset(widgetId);

    if (config.mode === 'snapshot') {
      window.location.assign(attributedDestination(config.thankYouPath, journeyId));
      return;
    }

    form.dataset.snapshotStarted = 'true';
    setStatus(
      config,
      'Your Snapshot is underway. Checkout unlocks when the saved result is complete.'
    );
    await watchSnapshot(config, session, () => {
      form.dataset.snapshotComplete = 'true';
      action.dataset.snapshotComplete = 'true';
      action.textContent = 'Continue to secure checkout — $5';
      action.disabled = tokenState.value.length === 0;
      setStatus(config, 'Your Snapshot is saved. Complete the fresh security check to continue.');
    });
  } catch {
    setStatus(config, 'We could not start your Snapshot. Check your details and try again.');
    action.disabled = tokenState.value.length === 0;
  }
}

function initializeThankYou(
  config: RuntimeConfig,
  tokenState: { value: string },
  turnstile: TurnstileApi,
  widgetId: string
) {
  const action = document.querySelector<HTMLButtonElement>('[data-blueprint-thank-you-checkout]');
  if (!action) return;
  action.classList.remove('cursor-not-allowed', 'opacity-60');
  const session = readSession(config.audience);
  if (!session) {
    revealSnapshotRestart(config);
    setStatus(config, 'Start from the Authority Snapshot page to access your saved result.');
    return;
  }
  document.querySelector<HTMLElement>('[data-blueprint-progress]')?.removeAttribute('hidden');
  setStatus(config, 'Snapshot request accepted.');
  let latestProgress: BlueprintProgress | null = null;
  action.addEventListener('click', () => {
    void beginCheckout(config, tokenState, turnstile, widgetId, action);
  });
  void watchSnapshot(
    config,
    session,
    (result) => {
      if (!renderSavedSnapshot(config, result)) {
        setStatus(
          config,
          'Your Snapshot is saved, but its result could not be displayed. Reload once.'
        );
        return;
      }
      document.querySelector<HTMLElement>('[data-blueprint-progress]')?.setAttribute('hidden', '');
      action.disabled = tokenState.value.length === 0;
      action.dataset.snapshotComplete = 'true';
      setStatus(config, 'Your Snapshot is saved. Complete the security check to continue for $5.');
    },
    (result) => {
      latestProgress = renderSnapshotProgress(config, result, latestProgress);
    }
  ).catch(() => {
    setStatus(config, 'We could not refresh this Snapshot. Reload once or start again.');
  });
}

async function watchSnapshot(
  config: RuntimeConfig,
  session: StoredSession,
  onComplete: (result: Record<string, unknown>) => void,
  onUpdate?: (result: Record<string, unknown>) => void
) {
  while (Date.now() < session.publicSessionExpiresAt) {
    const result = await callConvex(config, 'query', WATCH_PATH, {
      publicKey: session.publicSessionToken,
      workspaceSlug: config.workspaceSlug,
      routeKey: config.leadMagnetSlug,
    });
    if (isRecord(result)) onUpdate?.(result);
    if (isRecord(result) && result.complete === true) {
      onComplete(result);
      return;
    }
    if (isRecord(result) && result.stage === 'failed') {
      clearSession(config.audience);
      revealSnapshotRestart(config);
      setStatus(config, 'Your Snapshot needs a restart before checkout can continue.');
      return;
    }
    await delay(5_000);
  }
  clearSession(config.audience);
  revealSnapshotRestart(config);
  setStatus(config, 'This saved session has expired. Start a new Authority Snapshot.');
}

function renderSnapshotProgress(
  config: RuntimeConfig,
  result: Record<string, unknown>,
  previous: BlueprintProgress | null
) {
  const parsed = parseBlueprintProgress(result.progress);
  if (!parsed) return previous;
  const progress = previous ? mergeBlueprintProgress(previous, parsed) : parsed;
  const panel = document.querySelector<HTMLElement>('[data-blueprint-progress]');
  if (!panel) return progress;
  panel.removeAttribute('hidden');
  const latest = latestProgressEvent({
    ...progress,
    events: progress.events.filter((event) => event.key !== 'failed'),
  });
  for (const { key, state } of blueprintProgressStepStates(progress)) {
    const row = panel.querySelector<HTMLElement>(`[data-blueprint-progress-step="${key}"]`);
    if (!row) continue;
    row.dataset.state = state;
    setText(
      row,
      '[data-blueprint-progress-marker]',
      state === 'complete' ? '✓' : state === 'current' ? '●' : '○'
    );
    setText(
      row,
      '[data-blueprint-progress-state]',
      state === 'complete' ? 'Complete' : state === 'current' ? 'Latest update' : 'Waiting'
    );
  }
  const sourceEvent = progress.events.find((event) => event.key === 'sources_discovered');
  const source = panel.querySelector<HTMLElement>('[data-blueprint-progress-source]');
  source?.toggleAttribute('hidden', !sourceEvent);
  if (sourceEvent) {
    setText(panel, '[data-blueprint-progress-source-summary]', sourceEvent.summary);
  }
  setText(panel, '[data-blueprint-progress-elapsed]', elapsedLabel(progress.startedAt, Date.now()));
  setStatus(
    config,
    isBlueprintProgressStalled(progress, Date.now())
      ? 'Still working — profile research can sometimes take longer. Your session is saved, and reloading is safe.'
      : (latest?.summary ?? 'Snapshot request accepted.')
  );
  return progress;
}

function elapsedLabel(startedAt: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
  return minutes < 1 ? 'Elapsed: less than a minute' : `Elapsed: ${String(minutes)} min`;
}

function revealSnapshotRestart(config: RuntimeConfig) {
  if (config.mode === 'thank-you') {
    document.querySelector<HTMLElement>('[data-blueprint-restart-link]')?.removeAttribute('hidden');
  }
}

function renderSavedSnapshot(config: RuntimeConfig, result: Record<string, unknown>) {
  const snapshot = parseSavedSnapshot(result);
  const page = config.root.closest<HTMLElement>('[data-blueprint-page]');
  if (!snapshot || !page) return false;
  renderSavedScore(page, snapshot);
  renderSavedFindings(page, snapshot);
  renderSavedDraft(page, snapshot);
  page
    .querySelectorAll<HTMLElement>('[data-blueprint-result-content]')
    .forEach((content) => content.removeAttribute('hidden'));
  return true;
}

function parseSavedSnapshot(result: Record<string, unknown>): SavedSnapshot | null {
  const snapshot = result.authoritySnapshot;
  const posts = result.posts;
  const outcomes = result.postOutcomes;
  if (!isRecord(snapshot) || !Array.isArray(posts) || !Array.isArray(outcomes)) return null;
  const dimensions = parseDimensions(snapshot.dimensions);
  const findings = parseFindings(snapshot.findings);
  const post = parsePost(posts[0]);
  const outcome = parseOutcome(outcomes[0]);
  const unassessed = stringArray(snapshot.unassessedDimensionKeys);
  if (
    typeof snapshot.total !== 'number' ||
    typeof snapshot.maximum !== 'number' ||
    !dimensions ||
    !findings ||
    !post ||
    !outcome ||
    !unassessed
  ) {
    return null;
  }
  return {
    score: snapshot.total,
    maximum: snapshot.maximum,
    dimensions,
    findings,
    unassessedDimensionKeys: unassessed,
    post,
    outcome,
  };
}

function parseDimensions(value: unknown): SavedSnapshot['dimensions'] | null {
  if (!Array.isArray(value)) return null;
  const dimensions: SavedSnapshot['dimensions'] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.key !== 'string' ||
      typeof item.score !== 'number' ||
      typeof item.maximum !== 'number'
    ) {
      return null;
    }
    dimensions.push({ key: item.key, score: item.score, maximum: item.maximum });
  }
  return dimensions;
}

function parseFindings(value: unknown): SavedSnapshot['findings'] | null {
  if (!Array.isArray(value)) return null;
  const findings: SavedSnapshot['findings'] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.dimensionKey !== 'string' ||
      typeof item.criterionKey !== 'string' ||
      typeof item.reason !== 'string' ||
      typeof item.nextLevelCondition !== 'string'
    ) {
      return null;
    }
    findings.push({
      dimensionKey: item.dimensionKey,
      criterionKey: item.criterionKey,
      reason: item.reason,
      nextLevelCondition: item.nextLevelCondition,
      evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs.filter(isRecord) : [],
    });
  }
  return findings.slice(0, 3);
}

function parsePost(value: unknown): SavedSnapshot['post'] | null {
  if (!isRecord(value) || typeof value.body !== 'string') return null;
  return {
    title: typeof value.title === 'string' ? value.title : 'Your Authority Snapshot starter',
    body: value.body,
  };
}

function parseOutcome(value: unknown): SavedSnapshot['outcome'] | null {
  if (!isRecord(value) || !['ready', 'strong_starter'].includes(String(value.outcome))) return null;
  const questionsLeft = stringArray(value.questionsLeft);
  if (!questionsLeft) return null;
  return {
    outcome: value.outcome as SavedSnapshot['outcome']['outcome'],
    questionsLeft,
  };
}

function renderSavedScore(page: HTMLElement, snapshot: SavedSnapshot) {
  setText(page, '[data-blueprint-scorecard-label]', 'Your saved result');
  setText(page, '[data-blueprint-score]', String(snapshot.score));
  setText(page, '[data-blueprint-score-maximum]', String(snapshot.maximum));
  setText(page, '[data-blueprint-score-copy]', `${snapshot.score}/${snapshot.maximum}`);
  snapshot.dimensions.forEach((dimension, index) => {
    const row = page.querySelector<HTMLElement>(`[data-blueprint-dimension="${index}"]`);
    if (!row) return;
    setText(row, '[data-blueprint-dimension-label]', humanizeKey(dimension.key));
    setText(
      row,
      '[data-blueprint-dimension-score]',
      `${String(dimension.score)}/${String(dimension.maximum)}`
    );
    const progress = row.querySelector<HTMLElement>('[data-blueprint-dimension-progress]');
    const bar = row.querySelector<HTMLElement>('[data-blueprint-dimension-progress-bar]');
    progress?.setAttribute('aria-valuenow', String(dimension.score));
    progress?.setAttribute('aria-valuemax', String(dimension.maximum));
    if (bar)
      bar.style.width = `${String(Math.round((dimension.score / dimension.maximum) * 100))}%`;
    const finding =
      snapshot.findings.find((candidate) => candidate.dimensionKey === dimension.key) ??
      snapshot.findings[index];
    if (finding) {
      setText(row, '[data-blueprint-evidence-label]', `Source · ${evidenceLabel(finding)}`);
      setText(row, '[data-blueprint-evidence-body]', finding.reason);
    }
  });
  renderTextList(
    page.querySelector<HTMLElement>('[data-blueprint-unassessed-list]'),
    snapshot.unassessedDimensionKeys.map((key) => `? · Not assessed yet · ${humanizeKey(key)}`)
  );
}

function renderSavedFindings(page: HTMLElement, snapshot: SavedSnapshot) {
  setText(page, '[data-blueprint-findings-label]', 'Your evidence-linked findings');
  renderTextList(
    page.querySelector<HTMLElement>('[data-blueprint-findings]'),
    snapshot.findings.map((finding) => `${finding.reason} Next: ${finding.nextLevelCondition}`)
  );
}

function renderSavedDraft(page: HTMLElement, snapshot: SavedSnapshot) {
  setText(page, '[data-blueprint-draft-label]', 'Your saved draft 01');
  setText(page, '[data-blueprint-draft-title]', snapshot.post.title);
  setText(page, '[data-blueprint-draft-body]', snapshot.post.body);
  setText(
    page,
    '[data-blueprint-draft-outcome]',
    snapshot.outcome.outcome === 'ready' ? 'Ready' : 'Strong starter'
  );
  renderTextList(
    page.querySelector<HTMLElement>('[data-blueprint-draft-questions]'),
    snapshot.outcome.questionsLeft
  );
}

function renderTextList(list: HTMLElement | null, values: string[]) {
  if (!list) return;
  const items = values.map((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    return item;
  });
  list.replaceChildren(...items);
}

function setText(scope: ParentNode, selector: string, value: string) {
  const element = scope.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function humanizeKey(value: string) {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function evidenceLabel(finding: SavedSnapshot['findings'][number]) {
  return finding.evidenceRefs.length > 0
    ? 'governed LinkedIn or website evidence'
    : 'verified public evidence';
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}

async function beginCheckout(
  config: RuntimeConfig,
  tokenState: { value: string },
  turnstile: TurnstileApi,
  widgetId: string,
  action: HTMLButtonElement
) {
  const session = readSession(config.audience);
  if (!session || !tokenState.value || action.dataset.snapshotComplete !== 'true') {
    setStatus(config, 'Checkout unlocks after the Snapshot and security check are complete.');
    return;
  }
  await beginCheckoutForSession(config, tokenState, turnstile, widgetId, action, session);
}

async function beginCheckoutForSession(
  config: RuntimeConfig,
  tokenState: { value: string },
  turnstile: TurnstileApi,
  widgetId: string,
  action: HTMLButtonElement,
  session: StoredSession
) {
  action.disabled = true;
  setStatus(config, 'Preparing secure checkout…');
  try {
    const candidateEventId = session.candidateEventId ?? `initiate_checkout:${crypto.randomUUID()}`;
    session.candidateEventId = candidateEventId;
    const startResult = await callCheckoutProxy(config, 'checkout-start', {
      tracking_context_token: session.trackingContextToken,
      candidate_event_id: candidateEventId,
      public_session_token: session.publicSessionToken,
      checkout_idempotency_key: session.checkoutIdempotencyKey,
      turnstile_token: tokenState.value,
    });
    if (isRecord(startResult) && typeof startResult.tracking_context_token === 'string') {
      session.trackingContextToken = startResult.tracking_context_token;
    }
    tokenState.value = '';
    turnstile.reset(widgetId);
    storeReturnClaimToken(session.publicSessionToken);
    await watchCheckout(config, session);
  } catch {
    setStatus(config, 'Secure checkout could not be prepared. Please try again.');
    action.disabled = tokenState.value.length === 0;
  }
}

async function watchCheckout(config: RuntimeConfig, session: StoredSession) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const result = await callCheckoutProxy(config, 'checkout-status', {
      tracking_context_token: session.trackingContextToken,
      candidate_event_id:
        session.candidateEventId ?? `initiate_checkout:${session.checkoutIdempotencyKey}`,
      public_session_token: session.publicSessionToken,
      checkout_idempotency_key: session.checkoutIdempotencyKey,
    });
    if (isRecord(result) && result.state === 'ready' && typeof result.checkoutUrl === 'string') {
      const checkoutUrl = new URL(result.checkoutUrl);
      if (
        checkoutUrl.protocol !== 'https:' ||
        (checkoutUrl.hostname !== 'dodopayments.com' &&
          !checkoutUrl.hostname.endsWith('.dodopayments.com'))
      ) {
        throw new Error('Unexpected checkout URL');
      }
      window.location.assign(checkoutUrl.toString());
      return;
    }
    if (isRecord(result) && ['paid', 'expired', 'canceled'].includes(String(result.state ?? ''))) {
      throw new Error('Checkout is no longer available');
    }
    await delay(1_000);
  }
  throw new Error('Checkout preparation timed out');
}

function renderTurnstile(
  config: RuntimeConfig,
  turnstile: TurnstileApi,
  tokenState: { value: string }
) {
  const container = config.root.querySelector<HTMLElement>('[data-blueprint-turnstile]');
  if (!container) throw new Error('Turnstile container is missing');
  return turnstile.render(container, {
    sitekey: config.turnstileSiteKey,
    callback: (token: string) => {
      tokenState.value = token;
      enableReadyAction(config);
    },
    'expired-callback': () => {
      tokenState.value = '';
      disablePrimaryAction(config);
    },
    'error-callback': () => {
      tokenState.value = '';
      disablePrimaryAction(config);
      setStatus(config, 'The security check failed. Please retry it.');
    },
  });
}

function enableReadyAction(config: RuntimeConfig) {
  if (config.mode === 'asset') {
    const action = document.querySelector<HTMLButtonElement>('[data-blueprint-asset-checkout]');
    if (action?.dataset.snapshotComplete === 'true') action.disabled = false;
    return;
  }
  if (config.mode === 'thank-you') {
    const action = document.querySelector<HTMLButtonElement>('[data-blueprint-thank-you-checkout]');
    if (action?.dataset.snapshotComplete === 'true') action.disabled = false;
    return;
  }
  const form = config.root.closest<HTMLFormElement>('form');
  const action = form?.querySelector<HTMLButtonElement>('[data-blueprint-primary-action]');
  if (
    action &&
    !(
      config.mode === 'direct' &&
      form?.dataset.snapshotStarted === 'true' &&
      form.dataset.snapshotComplete !== 'true'
    )
  ) {
    action.disabled = false;
  }
}

function disablePrimaryAction(config: RuntimeConfig) {
  const selector =
    config.mode === 'asset'
      ? '[data-blueprint-asset-checkout]'
      : config.mode === 'thank-you'
        ? '[data-blueprint-thank-you-checkout]'
        : '[data-blueprint-primary-action]';
  document.querySelector<HTMLButtonElement>(selector)?.setAttribute('disabled', '');
}

async function callConvex(
  config: RuntimeConfig,
  kind: ConvexKind,
  path: string,
  args: Record<string, unknown>
) {
  const response = await fetch(`${config.convexUrl}/api/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok || !isRecord(payload) || payload.status !== 'success') {
    throw new Error(`Maestro ${kind} failed`);
  }
  return payload.value;
}

async function callCheckoutProxy(
  config: RuntimeConfig,
  operation: 'checkout-start' | 'checkout-status',
  args: Record<string, unknown>
) {
  const response = await fetch(`/api/blueprint/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok || !isRecord(payload) || typeof payload.error === 'string') {
    throw new Error(`Blueprint ${operation} failed`);
  }
  return payload;
}

function parseStartResult(value: unknown, journeyId: string): StoredSession {
  if (
    !isRecord(value) ||
    value.contractVersion !== 'v2' ||
    typeof value.publicSessionToken !== 'string' ||
    typeof value.publicSessionExpiresAt !== 'number'
  ) {
    throw new Error('Invalid Snapshot response');
  }
  return {
    publicSessionToken: value.publicSessionToken,
    publicSessionExpiresAt: value.publicSessionExpiresAt,
    journeyId,
    checkoutIdempotencyKey: `checkout_${crypto.randomUUID()}`,
    trackingContextToken:
      typeof value.tracking_context_token === 'string' ? value.tracking_context_token : '',
  };
}

function readAttribution() {
  const search = new URLSearchParams(window.location.search);
  const attribution: Record<string, string> = {};
  for (const [queryKey, contractKey] of ATTRIBUTION_KEYS) {
    const value = search.get(queryKey)?.trim();
    if (value && value.length <= 256) attribution[contractKey] = value;
  }
  return attribution;
}

function currentJourneyId() {
  const supplied = new URLSearchParams(window.location.search).get('journey_id') ?? '';
  if (/^[A-Za-z0-9_-]{16,128}$/.test(supplied)) return supplied;
  return `journey_${crypto.randomUUID()}`;
}

function sessionIdempotencyKey(audience: string) {
  const key = `blueprint:start:${audience}`;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = `snapshot_${crypto.randomUUID()}`;
  sessionStorage.setItem(key, created);
  return created;
}

function sessionStorageKey(audience: string) {
  return `blueprint:session:${audience}`;
}

function storeSession(audience: string, session: StoredSession) {
  sessionStorage.setItem(sessionStorageKey(audience), JSON.stringify(session));
}

function readSession(audience: string): StoredSession | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(sessionStorageKey(audience)) ?? 'null');
    if (!isRecord(parsed)) return null;
    if (
      typeof parsed.publicSessionToken !== 'string' ||
      typeof parsed.publicSessionExpiresAt !== 'number' ||
      typeof parsed.journeyId !== 'string' ||
      typeof parsed.checkoutIdempotencyKey !== 'string' ||
      typeof parsed.trackingContextToken !== 'string'
    ) {
      return null;
    }
    if (Date.now() >= parsed.publicSessionExpiresAt) {
      clearSession(audience);
      return null;
    }
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

function clearSession(audience: string) {
  sessionStorage.removeItem(sessionStorageKey(audience));
  sessionStorage.removeItem(`blueprint:start:${audience}`);
}

function storeReturnClaimToken(token: string) {
  sessionStorage.setItem(RETURN_CLAIM_TOKEN_KEY, token);
}

function readReturnClaimToken() {
  return nonEmpty(sessionStorage.getItem(RETURN_CLAIM_TOKEN_KEY));
}

function assetCheckoutIdempotencyKey(claimToken: string) {
  const storageKey = 'blueprint:asset:checkout';
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as unknown;
    if (
      isRecord(stored) &&
      stored.claimToken === claimToken &&
      typeof stored.checkoutIdempotencyKey === 'string'
    ) {
      return stored.checkoutIdempotencyKey;
    }
  } catch {
    // Replace malformed device-local state with a fresh idempotency key.
  }
  const checkoutIdempotencyKey = `checkout_${crypto.randomUUID()}`;
  sessionStorage.setItem(storageKey, JSON.stringify({ claimToken, checkoutIdempotencyKey }));
  return checkoutIdempotencyKey;
}

function initializeMobileSnapshotAction(form: HTMLFormElement) {
  const action = document.querySelector<HTMLButtonElement>(
    '[data-acceptance-cta="snapshot-mobile"]'
  );
  if (!action) return;
  action.disabled = false;
  action.classList.remove('cursor-not-allowed', 'opacity-60');
  action.addEventListener('click', () => {
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.querySelector<HTMLInputElement>('input[data-blueprint-input]')?.focus();
  });
}

function attributedDestination(path: string, journeyId: string) {
  const destination = new URL(path, window.location.origin);
  const current = new URLSearchParams(window.location.search);
  for (const [key] of ATTRIBUTION_KEYS) {
    const value = current.get(key);
    if (value) destination.searchParams.set(key, value);
  }
  destination.searchParams.set('journey_id', journeyId);
  return destination.toString();
}

function setStatus(config: RuntimeConfig, message: string) {
  const scope = config.root.closest('form') ?? config.root.closest('[data-blueprint-page]');
  const status = scope?.querySelector<HTMLElement>('[data-blueprint-runtime-status]');
  if (status) status.textContent = message;
}

function isMode(value: string | undefined): value is FunnelMode {
  return (
    value === 'snapshot' ||
    value === 'direct' ||
    value === 'thank-you' ||
    value === 'asset' ||
    value === 'checkout-return'
  );
}

function requiresAudience(mode: FunnelMode) {
  return mode === 'snapshot' || mode === 'direct' || mode === 'thank-you';
}

function requiresTurnstile(mode: FunnelMode) {
  return mode !== 'checkout-return';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitForTurnstile(): Promise<TurnstileApi | null> {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }
      attempts += 1;
      if (attempts >= 100) {
        resolve(null);
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  });
}

initializeBlueprintFunnels();
document.addEventListener('astro:after-swap', initializeBlueprintFunnels);
