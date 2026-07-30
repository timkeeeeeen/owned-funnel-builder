export const QUALITY_SCHEMA_VERSION = '1.0.0' as const;
export const QUALITY_TOOL_VERSION = '1.0.0' as const;

export const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;
export type CaptureKind = 'first-fold' | 'full-page';
export type CtaKind = 'internal' | 'external' | 'checkout';

export interface PrimaryCtaConfig {
  kind: CtaKind;
  selector?: string;
  expectedDestination?: string;
  allowedOrigins?: string[];
  activate?: boolean;
  readySelector?: string;
}

export interface QualityRouteConfig {
  route: string;
  name?: string;
  profiles?: ViewportName[];
  captures?: CaptureKind[];
  primaryCta?: PrimaryCtaConfig;
  ignoreResourcePatterns?: string[];
}

export interface QualityConfig {
  distDirectory?: string;
  evidenceDirectory?: string;
  routes?: QualityRouteConfig[];
  excludeRoutes?: string[];
  maxFullPageHeight?: number;
  maxImageBytes?: number;
}

export interface AccessibilityViolation {
  id: string;
  impact: string | null;
  description: string;
  nodes: number;
}

export interface CtaCheckResult {
  kind: CtaKind;
  selector: string;
  found: number;
  label?: string;
  destination?: string;
  keyboardFocusVisible?: boolean;
  activated?: boolean;
  readySelector?: string;
  passed: boolean;
  errors: string[];
}

export interface SmokeRouteResult {
  route: string;
  profile: ViewportName;
  title: string;
  horizontalOverflow: number;
  pageErrors: string[];
  consoleErrors: string[];
  resourceErrors: string[];
  accessibilityViolations: AccessibilityViolation[];
  primaryCta?: CtaCheckResult;
  passed: boolean;
}

export interface SmokeReceipt {
  schemaVersion: typeof QUALITY_SCHEMA_VERSION;
  toolVersion: typeof QUALITY_TOOL_VERSION;
  createdAt: string;
  buildFingerprint: string;
  configFingerprint: string;
  routes: SmokeRouteResult[];
  passed: boolean;
}

export interface CaptureEntry {
  route: string;
  profile: ViewportName;
  kind: CaptureKind;
  path: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
}

export interface RouteEvidence {
  route: string;
  buildFingerprint: string;
  captures: CaptureEntry[];
}

export interface CaptureManifest {
  schemaVersion: typeof QUALITY_SCHEMA_VERSION;
  toolVersion: typeof QUALITY_TOOL_VERSION;
  capturedAt: string;
  playwrightVersion: string;
  chromiumVersion: string;
  configFingerprint: string;
  distDirectory: string;
  smokeReceiptPath: string;
  environment: {
    locale: 'en-US';
    timezoneId: 'UTC';
    colorScheme: 'light';
    reducedMotion: 'reduce';
    deviceScaleFactor: 1;
  };
  routes: RouteEvidence[];
}

export interface FreshnessProblem {
  route?: string;
  path?: string;
  message: string;
}

export interface FreshnessResult {
  passed: boolean;
  problems: FreshnessProblem[];
}

export const DEFAULT_PROFILES: ViewportName[] = ['desktop', 'tablet', 'mobile'];
export const DEFAULT_CAPTURES: CaptureKind[] = ['first-fold', 'full-page'];
export const DEFAULT_CTA_SELECTOR = '[data-primary-cta]';
export const DEFAULT_CHECKOUT_READY_SELECTOR =
  "[data-checkout-dialog][open], dialog[open], [role='dialog'], iframe[src*='checkout']";
