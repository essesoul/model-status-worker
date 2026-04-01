export const DASHBOARD_RANGES = ["30h", "24h", "7d", "30d"] as const;

export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export type ProbeLevel = "up" | "degraded" | "down" | "empty";

export type ProbeStatusSample = {
  id: string;
  startedAt: string;
  endedAt: string;
  score: number | null;
  level: ProbeLevel;
  probeCount: number;
  successCount: number;
  avgConnectivityLatencyMs: number | null;
  avgTotalLatencyMs: number | null;
};

export type ModelSummary = {
  upstreamId: string;
  upstreamName: string;
  upstreamGroup: string;
  model: string;
  displayName: string | null;
  icon: string | null;
  isVisible: boolean;
  sortOrder: number;
  created: number | null;
  ownedBy: string | null;
  probes: number;
  successes: number;
  failures: number;
  availabilityPercentage: number;
  avgConnectivityLatencyMs: number | null;
  avgFirstTokenLatencyMs: number | null;
  avgTotalLatencyMs: number | null;
  lastProbeAt: string | null;
  latestStatus: ProbeLevel;
  recentStatuses: ProbeStatusSample[];
};

export type DashboardSummary = {
  totalModels: number;
  availableModels: number;
  degradedModels: number;
  errorModels: number;
  hiddenModels: number;
  availabilityPercentage: number;
  avgConnectivityLatencyMs: number | null;
  avgFirstTokenLatencyMs: number | null;
  avgTotalLatencyMs: number | null;
  lastProbeAt: string | null;
};

export type DashboardResponse = {
  meta: {
    siteTitle: string;
    siteSubtitle: string;
    range: DashboardRange;
    generatedAt: string;
    nextProbeAt: string | null;
    lastProbeAt: string | null;
    lastCatalogSyncAt: string | null;
    probeIntervalMs: number;
    isProbeCycleRunning: boolean;
    showSummaryCards: boolean;
  };
  summary: DashboardSummary;
  models: ModelSummary[];
};

export type UpstreamInput = {
  id?: string;
  name: string;
  group?: string;
  apiBaseUrl: string;
  modelsUrl: string;
  apiKey?: string;
  isActive?: boolean;
};

export type UpstreamView = {
  id: string;
  name: string;
  group: string;
  apiBaseUrl: string;
  modelsUrl: string;
  isActive: boolean;
  apiKeyConfigured: boolean;
  apiKeyMasked: string | null;
};

export type TurnstileInput = {
  enabled?: boolean;
  siteKey?: string;
  secretKey?: string;
};

export type TurnstileLoginConfig = {
  enabled: boolean;
  siteKey: string;
};

export type TurnstileAdminConfig = {
  enabled: boolean;
  siteKey: string;
  secretKeyConfigured: boolean;
  secretKeyMasked: string | null;
};

export type AdminSettings = {
  siteTitle: string;
  siteSubtitle: string;
  showSummaryCards: boolean;
  probeIntervalMs: number;
  catalogSyncIntervalMs: number;
  probeTimeoutMs: number;
  probeConcurrency: number;
  probeMaxTokens: number;
  probeTemperature: number;
  degradedRetryAttempts: number;
  failedRetryAttempts: number;
  modelStatusUpScoreThreshold: number;
  modelStatusDegradedScoreThreshold: number;
};

export type AdminSettingsResponse = {
  settings: AdminSettings;
  upstreams: UpstreamView[];
  apiKeyConfigured: boolean;
  turnstile: TurnstileAdminConfig;
};

export type AdminDashboardResponse = DashboardResponse;

export type UpdateAdminSettingsRequest = Partial<AdminSettings> & {
  upstreams?: UpstreamInput[];
  turnstile?: TurnstileInput;
};

export type UpdateAdminModelsRequest = {
  models: Array<{
    upstreamId: string;
    id: string;
    displayName: string | null;
    icon: string | null;
    isVisible: boolean;
    sortOrder: number;
  }>;
};

export type AdminActionResponse = {
  ok: true;
  message: string;
  detail?: Record<string, unknown>;
};

export type ProbeStreamEvent =
  | {
      type: "cycle-started";
      startedAt: string;
      total: number;
    }
  | {
      type: "attempt-started";
      startedAt: string;
      upstreamId: string;
      upstreamName: string;
      model: string;
      attempt: number;
    }
  | {
      type: "attempt-finished";
      finishedAt: string;
      upstreamId: string;
      upstreamName: string;
      model: string;
      attempt: number;
      result: {
        success: boolean;
        statusCode: number | null;
        error: string | null;
        connectivityLatencyMs: number | null;
        firstTokenLatencyMs: number | null;
        totalLatencyMs: number;
      };
      score: number;
      classification: Exclude<ProbeLevel, "empty">;
    }
  | {
      type: "cycle-finished";
      startedAt: string;
      finishedAt: string;
      total: number;
      succeeded: number;
      failed: number;
    };

export type AdminSessionResponse = {
  authenticated: boolean;
  username: string | null;
  turnstile: TurnstileLoginConfig;
};

export type LoginRequest = {
  username: string;
  password: string;
  turnstileToken?: string | null;
};

export type ProbeAttemptResult = {
  upstreamId: string;
  upstreamName: string;
  model: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  connectivityLatencyMs?: number;
  firstTokenLatencyMs?: number;
  totalLatencyMs: number;
  rawResponseText?: string;
};

export function isDashboardRange(value: string): value is DashboardRange {
  return DASHBOARD_RANGES.includes(value as DashboardRange);
}

export function rangeStartIso(range: DashboardRange, toDate = new Date()): string {
  const copy = new Date(toDate);

  switch (range) {
    case "30h":
      copy.setHours(copy.getHours() - 30);
      break;
    case "24h":
      copy.setHours(copy.getHours() - 24);
      break;
    case "7d":
      copy.setDate(copy.getDate() - 7);
      break;
    case "30d":
      copy.setDate(copy.getDate() - 30);
      break;
  }

  return copy.toISOString();
}
