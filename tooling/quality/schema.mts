import {
  QUALITY_SCHEMA_VERSION,
  QUALITY_TOOL_VERSION,
  VIEWPORTS,
  type CaptureManifest,
  type SmokeReceipt,
} from './contracts.mts';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must contain text`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-f\d]{64}$/.test(result)) throw new Error(`${label} must be a SHA-256 hash`);
  return result;
}

function versioned(value: unknown, label: string): Record<string, unknown> {
  const input = object(value, label);
  if (input.schemaVersion !== QUALITY_SCHEMA_VERSION) {
    throw new Error(`${label} uses an unsupported schema version`);
  }
  if (input.toolVersion !== QUALITY_TOOL_VERSION) {
    throw new Error(`${label} was created by an unsupported quality tool version`);
  }
  return input;
}

export function parseSmokeReceipt(value: unknown): SmokeReceipt {
  const input = versioned(value, 'Smoke receipt');
  text(input.createdAt, 'Smoke receipt createdAt');
  sha(input.buildFingerprint, 'Smoke receipt buildFingerprint');
  sha(input.configFingerprint, 'Smoke receipt configFingerprint');
  if (!Array.isArray(input.routes) || input.routes.length === 0) {
    throw new Error('Smoke receipt must include checked routes');
  }
  if (typeof input.passed !== 'boolean') throw new Error('Smoke receipt passed must be boolean');
  for (const [index, route] of input.routes.entries()) {
    const item = object(route, `Smoke route ${index + 1}`);
    text(item.route, `Smoke route ${index + 1} route`);
    if (!(typeof item.profile === 'string' && item.profile in VIEWPORTS)) {
      throw new Error(`Smoke route ${index + 1} has an unknown viewport`);
    }
    for (const field of [
      'pageErrors',
      'consoleErrors',
      'resourceErrors',
      'accessibilityViolations',
    ]) {
      if (!Array.isArray(item[field]))
        throw new Error(`Smoke route ${index + 1} ${field} must be a list`);
    }
    if (typeof item.passed !== 'boolean')
      throw new Error(`Smoke route ${index + 1} passed must be boolean`);
  }
  const routePasses = (input.routes as Array<Record<string, unknown>>).every(
    (route) => route.passed === true
  );
  if (input.passed !== routePasses) {
    throw new Error('Smoke receipt summary does not agree with its route results');
  }
  return value as SmokeReceipt;
}

export function parseCaptureManifest(value: unknown): CaptureManifest {
  const input = versioned(value, 'Capture manifest');
  text(input.capturedAt, 'Capture manifest capturedAt');
  text(input.playwrightVersion, 'Capture manifest playwrightVersion');
  text(input.chromiumVersion, 'Capture manifest chromiumVersion');
  text(input.distDirectory, 'Capture manifest distDirectory');
  text(input.smokeReceiptPath, 'Capture manifest smokeReceiptPath');
  sha(input.configFingerprint, 'Capture manifest configFingerprint');
  if (!Array.isArray(input.routes) || input.routes.length === 0) {
    throw new Error('Capture manifest must include routes');
  }
  for (const [routeIndex, route] of input.routes.entries()) {
    const item = object(route, `Capture route ${routeIndex + 1}`);
    text(item.route, `Capture route ${routeIndex + 1} route`);
    sha(item.buildFingerprint, `Capture route ${routeIndex + 1} buildFingerprint`);
    if (!Array.isArray(item.captures) || item.captures.length === 0) {
      throw new Error(`Capture route ${routeIndex + 1} must include screenshots`);
    }
    for (const [captureIndex, capture] of item.captures.entries()) {
      const entry = object(capture, `Screenshot ${captureIndex + 1}`);
      text(entry.path, `Screenshot ${captureIndex + 1} path`);
      sha(entry.sha256, `Screenshot ${captureIndex + 1} sha256`);
      if (!(typeof entry.profile === 'string' && entry.profile in VIEWPORTS)) {
        throw new Error(`Screenshot ${captureIndex + 1} has an unknown viewport`);
      }
      if (!(['first-fold', 'full-page'] as unknown[]).includes(entry.kind)) {
        throw new Error(`Screenshot ${captureIndex + 1} has an unknown capture kind`);
      }
      for (const field of ['width', 'height', 'byteSize'] as const) {
        if (!Number.isInteger(entry[field]) || Number(entry[field]) <= 0) {
          throw new Error(`Screenshot ${captureIndex + 1} ${field} must be positive`);
        }
      }
    }
  }
  return value as CaptureManifest;
}
