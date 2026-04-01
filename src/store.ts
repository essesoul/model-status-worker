import type {
  AdminSettings,
  AdminSettingsResponse,
  ProbeAttemptResult,
  TurnstileAdminConfig,
  TurnstileInput,
  TurnstileLoginConfig,
  UpstreamInput,
} from "./shared";
import { rangeStartIso } from "./shared";

export type UpstreamRecord = {
  id: string;
  name: string;
  group: string;
  apiBaseUrl: string;
  modelsUrl: string;
  apiKey: string;
  isActive: boolean;
  updatedAt: string;
};

export type ModelRecord = {
  upstreamId: string;
  id: string;
  created: number | null;
  ownedBy: string | null;
  displayName: string | null;
  icon: string | null;
  isVisible: boolean;
  sortOrder: number;
  syncedAt: string;
  isActive: boolean;
};

export type ProbeRecord = {
  id: number;
  upstreamId: string;
  upstreamName: string;
  model: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  statusCode: number | null;
  error: string | null;
  connectivityLatencyMs: number | null;
  firstTokenLatencyMs: number | null;
  totalLatencyMs: number;
  rawResponseText: string | null;
};

export const PROBE_HISTORY_RETENTION_RANGE = "30d" as const;

export const SETTING_KEYS = {
  siteTitle: "SITE_TITLE",
  siteSubtitle: "SITE_SUBTITLE",
  showSummaryCards: "SHOW_SUMMARY_CARDS",
  probeIntervalMs: "PROBE_INTERVAL_MS",
  catalogSyncIntervalMs: "CATALOG_SYNC_INTERVAL_MS",
  probeTimeoutMs: "PROBE_TIMEOUT_MS",
  probeConcurrency: "PROBE_CONCURRENCY",
  probeMaxTokens: "PROBE_MAX_TOKENS",
  probeTemperature: "PROBE_TEMPERATURE",
  degradedRetryAttempts: "DEGRADED_RETRY_ATTEMPTS",
  failedRetryAttempts: "FAILED_RETRY_ATTEMPTS",
  modelStatusUpScoreThreshold: "MODEL_STATUS_UP_SCORE_THRESHOLD",
  modelStatusDegradedScoreThreshold: "MODEL_STATUS_DEGRADED_SCORE_THRESHOLD",
  turnstileEnabled: "TURNSTILE_ENABLED",
  turnstileSiteKey: "TURNSTILE_SITE_KEY",
  turnstileSecretKey: "TURNSTILE_SECRET_KEY",
  lastCatalogSyncAt: "LAST_CATALOG_SYNC_AT",
  lastProbeAt: "LAST_PROBE_AT",
  lastProbeStartedAt: "LAST_PROBE_STARTED_AT",
  lastProbeFinishedAt: "LAST_PROBE_FINISHED_AT",
} as const;

export type RuntimeSettings = AdminSettings & {
  upstreams: UpstreamRecord[];
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  lastCatalogSyncAt: string | null;
  lastProbeAt: string | null;
  lastProbeStartedAt: string | null;
  lastProbeFinishedAt: string | null;
};

type KeyValueRow = {
  key: string;
  value: string;
};

type UpstreamRow = {
  id: string;
  name: string;
  upstream_group: string;
  api_base_url: string;
  models_url: string;
  api_key: string;
  is_active: number;
  updated_at: string;
};

type ModelRow = {
  upstream_id: string;
  id: string;
  created: number | null;
  owned_by: string | null;
  display_name: string | null;
  icon: string | null;
  is_visible: number;
  sort_order: number;
  synced_at: string;
  is_active: number;
};

type ProbeRow = {
  id: number;
  upstream_id: string;
  upstream_name: string;
  model: string;
  started_at: string;
  completed_at: string;
  success: number;
  status_code: number | null;
  error: string | null;
  connectivity_latency_ms: number | null;
  first_token_latency_ms: number | null;
  total_latency_ms: number;
  raw_response_text: string | null;
};

const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  siteTitle: "Model Status worker",
  siteSubtitle: "Cloudflare-native status board for OpenAI-compatible model APIs",
  showSummaryCards: true,
  probeIntervalMs: 60 * 60_000,
  catalogSyncIntervalMs: 15 * 60_000,
  probeTimeoutMs: 20_000,
  probeConcurrency: 4,
  probeMaxTokens: 4,
  probeTemperature: 0,
  degradedRetryAttempts: 1,
  failedRetryAttempts: 0,
  modelStatusUpScoreThreshold: 60,
  modelStatusDegradedScoreThreshold: 30,
};

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

export function sanitizeUpstreamId(name: string, fallbackIndex: number): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return id || `upstream-${fallbackIndex}`;
}

function maskApiKey(apiKey: string): string | null {
  if (!apiKey) {
    return null;
  }

  return `****${apiKey.slice(-4)}`;
}

function toUpstreamRecord(row: UpstreamRow): UpstreamRecord {
  return {
    id: row.id,
    name: row.name,
    group: row.upstream_group,
    apiBaseUrl: row.api_base_url,
    modelsUrl: row.models_url,
    apiKey: row.api_key,
    isActive: Boolean(row.is_active),
    updatedAt: row.updated_at,
  };
}

function toModelRecord(row: ModelRow): ModelRecord {
  return {
    upstreamId: row.upstream_id,
    id: row.id,
    created: row.created,
    ownedBy: row.owned_by,
    displayName: row.display_name,
    icon: row.icon,
    isVisible: Boolean(row.is_visible),
    sortOrder: row.sort_order,
    syncedAt: row.synced_at,
    isActive: Boolean(row.is_active),
  };
}

function toProbeRecord(row: ProbeRow): ProbeRecord {
  return {
    id: row.id,
    upstreamId: row.upstream_id,
    upstreamName: row.upstream_name,
    model: row.model,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    success: Boolean(row.success),
    statusCode: row.status_code,
    error: row.error,
    connectivityLatencyMs: row.connectivity_latency_ms,
    firstTokenLatencyMs: row.first_token_latency_ms,
    totalLatencyMs: row.total_latency_ms,
    rawResponseText: row.raw_response_text,
  };
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();

  return row?.value ?? null;
}

export async function listSettings(db: D1Database): Promise<Record<string, string>> {
  const result = await db.prepare("SELECT key, value FROM app_settings").all<KeyValueRow>();
  return (result.results ?? []).reduce<Record<string, string>>((accumulator, row) => {
    accumulator[row.key] = row.value;
    return accumulator;
  }, {});
}

export async function setSetting(db: D1Database, key: string, value: string, updatedAt: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, updatedAt)
    .run();
}

async function setSettingsBatch(
  db: D1Database,
  entries: Array<{ key: string; value: string }>,
  updatedAt: string,
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  await db.batch(
    entries.map(({ key, value }) =>
      db
        .prepare(
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(key, value, updatedAt),
    ),
  );
}

export async function listUpstreams(db: D1Database, activeOnly = false): Promise<UpstreamRecord[]> {
  const query = activeOnly
    ? "SELECT * FROM upstreams WHERE is_active = 1 ORDER BY upstream_group, name"
    : "SELECT * FROM upstreams ORDER BY is_active DESC, upstream_group, name";
  const result = await db.prepare(query).all<UpstreamRow>();
  return (result.results ?? []).map(toUpstreamRecord);
}

export async function upsertUpstream(db: D1Database, upstream: UpstreamRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO upstreams (id, name, upstream_group, api_base_url, models_url, api_key, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         upstream_group = excluded.upstream_group,
         api_base_url = excluded.api_base_url,
         models_url = excluded.models_url,
         api_key = excluded.api_key,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at`,
    )
    .bind(
      upstream.id,
      upstream.name,
      upstream.group,
      upstream.apiBaseUrl,
      upstream.modelsUrl,
      upstream.apiKey,
      upstream.isActive ? 1 : 0,
      upstream.updatedAt,
    )
    .run();
}

export async function deleteUpstreamsByIds(db: D1Database, upstreamIds: string[]): Promise<void> {
  if (upstreamIds.length === 0) {
    return;
  }

  const placeholders = upstreamIds.map(() => "?").join(", ");

  await db.prepare(`DELETE FROM probes WHERE upstream_id IN (${placeholders})`).bind(...upstreamIds).run();
  await db.prepare(`DELETE FROM models WHERE upstream_id IN (${placeholders})`).bind(...upstreamIds).run();
  await db.prepare(`DELETE FROM upstreams WHERE id IN (${placeholders})`).bind(...upstreamIds).run();
}

export async function listModels(db: D1Database, activeOnly = false): Promise<ModelRecord[]> {
  const query = activeOnly
    ? "SELECT * FROM models WHERE is_active = 1 ORDER BY upstream_id, sort_order, id"
    : "SELECT * FROM models ORDER BY is_active DESC, upstream_id, sort_order, id";
  const result = await db.prepare(query).all<ModelRow>();
  return (result.results ?? []).map(toModelRecord);
}

export async function upsertModel(db: D1Database, model: ModelRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO models (
         upstream_id, id, created, owned_by, display_name, icon, is_visible, sort_order, synced_at, is_active
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(upstream_id, id) DO UPDATE SET
         created = excluded.created,
         owned_by = excluded.owned_by,
         display_name = COALESCE(models.display_name, excluded.display_name),
         icon = COALESCE(models.icon, excluded.icon),
         is_visible = COALESCE(models.is_visible, excluded.is_visible),
         sort_order = COALESCE(models.sort_order, excluded.sort_order),
         synced_at = excluded.synced_at,
         is_active = excluded.is_active`,
    )
    .bind(
      model.upstreamId,
      model.id,
      model.created,
      model.ownedBy,
      model.displayName,
      model.icon,
      model.isVisible ? 1 : 0,
      model.sortOrder,
      model.syncedAt,
      model.isActive ? 1 : 0,
    )
    .run();
}

export async function updateModelMetadata(
  db: D1Database,
  model: {
    upstreamId: string;
    id: string;
    displayName: string | null;
    icon: string | null;
    isVisible: boolean;
    sortOrder: number;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE models
       SET display_name = ?, icon = ?, is_visible = ?, sort_order = ?
       WHERE upstream_id = ? AND id = ?`,
    )
    .bind(
      model.displayName,
      model.icon,
      model.isVisible ? 1 : 0,
      model.sortOrder,
      model.upstreamId,
      model.id,
    )
    .run();
}

export async function deleteModelsByKeys(
  db: D1Database,
  modelKeys: Array<{ upstreamId: string; id: string }>,
): Promise<void> {
  if (modelKeys.length === 0) {
    return;
  }

  for (const model of modelKeys) {
    await db
      .prepare("DELETE FROM probes WHERE upstream_id = ? AND model = ?")
      .bind(model.upstreamId, model.id)
      .run();

    await db
      .prepare("DELETE FROM models WHERE upstream_id = ? AND id = ?")
      .bind(model.upstreamId, model.id)
      .run();
  }
}

export async function deactivateMissingModels(
  db: D1Database,
  upstreamId: string,
  activeModelIds: string[],
  syncedAt: string,
): Promise<void> {
  if (activeModelIds.length === 0) {
    await db
      .prepare("UPDATE models SET is_active = 0, synced_at = ? WHERE upstream_id = ?")
      .bind(syncedAt, upstreamId)
      .run();
    return;
  }

  const placeholders = activeModelIds.map(() => "?").join(", ");
  await db
    .prepare(
      `UPDATE models
       SET is_active = 0, synced_at = ?
       WHERE upstream_id = ? AND id NOT IN (${placeholders})`,
    )
    .bind(syncedAt, upstreamId, ...activeModelIds)
    .run();
}

export async function insertProbe(db: D1Database, probe: ProbeAttemptResult): Promise<void> {
  await db
    .prepare(
      `INSERT INTO probes (
         upstream_id,
         upstream_name,
         model,
         started_at,
         completed_at,
         success,
         status_code,
         error,
         connectivity_latency_ms,
         first_token_latency_ms,
         total_latency_ms,
         raw_response_text
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      probe.upstreamId,
      probe.upstreamName,
      probe.model,
      probe.startedAt,
      probe.completedAt,
      probe.success ? 1 : 0,
      probe.statusCode ?? null,
      probe.error ?? null,
      probe.connectivityLatencyMs ?? null,
      probe.firstTokenLatencyMs ?? null,
      probe.totalLatencyMs,
      probe.rawResponseText ?? null,
    )
    .run();
}

export function getOutdatedProbeCutoffIso(now = new Date()): string {
  return rangeStartIso(PROBE_HISTORY_RETENTION_RANGE, now);
}

export async function deleteProbesStartedBefore(db: D1Database, cutoffIso: string): Promise<number> {
  const result = await db
    .prepare("DELETE FROM probes WHERE started_at < ?")
    .bind(cutoffIso)
    .run();

  return Number(result.meta.changes ?? 0);
}

export async function listProbesSince(db: D1Database, sinceIso: string): Promise<ProbeRecord[]> {
  const result = await db
    .prepare("SELECT * FROM probes WHERE started_at >= ? ORDER BY started_at ASC")
    .bind(sinceIso)
    .all<ProbeRow>();
  return (result.results ?? []).map(toProbeRecord);
}

export function getDefaultAdminSettings(): AdminSettings {
  return { ...DEFAULT_ADMIN_SETTINGS };
}

export async function ensureBootstrap(db: D1Database): Promise<void> {
  const nowIso = new Date().toISOString();
  const settings = await listSettings(db);
  const defaults = getDefaultAdminSettings();
  const legacyDefaultProbeIntervalMs = String(5 * 60_000);
  const nextDefaultProbeIntervalMs = String(defaults.probeIntervalMs);

  await setSettingsBatch(
    db,
    [
      [SETTING_KEYS.siteTitle, defaults.siteTitle],
      [SETTING_KEYS.siteSubtitle, defaults.siteSubtitle],
      [SETTING_KEYS.showSummaryCards, defaults.showSummaryCards ? "1" : "0"],
      [SETTING_KEYS.probeIntervalMs, String(defaults.probeIntervalMs)],
      [SETTING_KEYS.catalogSyncIntervalMs, String(defaults.catalogSyncIntervalMs)],
      [SETTING_KEYS.probeTimeoutMs, String(defaults.probeTimeoutMs)],
      [SETTING_KEYS.probeConcurrency, String(defaults.probeConcurrency)],
      [SETTING_KEYS.probeMaxTokens, String(defaults.probeMaxTokens)],
      [SETTING_KEYS.probeTemperature, String(defaults.probeTemperature)],
      [SETTING_KEYS.degradedRetryAttempts, String(defaults.degradedRetryAttempts)],
      [SETTING_KEYS.failedRetryAttempts, String(defaults.failedRetryAttempts)],
      [SETTING_KEYS.modelStatusUpScoreThreshold, String(defaults.modelStatusUpScoreThreshold)],
      [SETTING_KEYS.modelStatusDegradedScoreThreshold, String(defaults.modelStatusDegradedScoreThreshold)],
      [SETTING_KEYS.turnstileEnabled, "0"],
      [SETTING_KEYS.turnstileSiteKey, ""],
      [SETTING_KEYS.turnstileSecretKey, ""],
    ]
      .filter(([key]) => !(key in settings))
      .map(([key, value]) => ({ key, value })),
    nowIso,
  );

  if (settings[SETTING_KEYS.probeIntervalMs] === legacyDefaultProbeIntervalMs) {
    await setSetting(db, SETTING_KEYS.probeIntervalMs, nextDefaultProbeIntervalMs, nowIso);
  }

  const upstreams = await listUpstreams(db, false);
  if (upstreams.length === 0 && Object.keys(settings).length === 0) {
    await upsertUpstream(db, {
      id: "default",
      name: "Default Upstream",
      group: "default",
      apiBaseUrl: "https://api.openai.com/v1",
      modelsUrl: "https://api.openai.com/v1/models",
      apiKey: "",
      isActive: true,
      updatedAt: nowIso,
    });
  }
}

function parseSettings(raw: Record<string, string>): AdminSettings {
  const defaults = getDefaultAdminSettings();

  return {
    siteTitle: raw[SETTING_KEYS.siteTitle] ?? defaults.siteTitle,
    siteSubtitle: raw[SETTING_KEYS.siteSubtitle] ?? defaults.siteSubtitle,
    showSummaryCards: raw[SETTING_KEYS.showSummaryCards] !== "0",
    probeIntervalMs: clampNumber(Number(raw[SETTING_KEYS.probeIntervalMs] ?? defaults.probeIntervalMs), 60_000, 86_400_000),
    catalogSyncIntervalMs: clampNumber(Number(raw[SETTING_KEYS.catalogSyncIntervalMs] ?? defaults.catalogSyncIntervalMs), 60_000, 86_400_000),
    probeTimeoutMs: clampNumber(Number(raw[SETTING_KEYS.probeTimeoutMs] ?? defaults.probeTimeoutMs), 2_000, 120_000),
    probeConcurrency: clampNumber(Number(raw[SETTING_KEYS.probeConcurrency] ?? defaults.probeConcurrency), 1, 12),
    probeMaxTokens: clampNumber(Number(raw[SETTING_KEYS.probeMaxTokens] ?? defaults.probeMaxTokens), 1, 64),
    probeTemperature: clampNumber(Number(raw[SETTING_KEYS.probeTemperature] ?? defaults.probeTemperature), 0, 2),
    degradedRetryAttempts: clampNumber(Number(raw[SETTING_KEYS.degradedRetryAttempts] ?? defaults.degradedRetryAttempts), 0, 3),
    failedRetryAttempts: clampNumber(Number(raw[SETTING_KEYS.failedRetryAttempts] ?? defaults.failedRetryAttempts), 0, 3),
    modelStatusUpScoreThreshold: clampNumber(Number(raw[SETTING_KEYS.modelStatusUpScoreThreshold] ?? defaults.modelStatusUpScoreThreshold), 0, 100),
    modelStatusDegradedScoreThreshold: clampNumber(Number(raw[SETTING_KEYS.modelStatusDegradedScoreThreshold] ?? defaults.modelStatusDegradedScoreThreshold), 0, 100),
  };
}

function parseTurnstileConfig(raw: Record<string, string>): TurnstileLoginConfig & { secretKey: string } {
  return {
    enabled: raw[SETTING_KEYS.turnstileEnabled] === "1",
    siteKey: raw[SETTING_KEYS.turnstileSiteKey] ?? "",
    secretKey: raw[SETTING_KEYS.turnstileSecretKey] ?? "",
  };
}

export async function getRuntimeSettings(db: D1Database): Promise<RuntimeSettings> {
  await ensureBootstrap(db);
  const rawSettings = await listSettings(db);
  const adminSettings = parseSettings(rawSettings);
  const turnstile = parseTurnstileConfig(rawSettings);
  const upstreams = (await listUpstreams(db, true))
    .filter((upstream) => upstream.apiKey.trim().length > 0)
    .map((upstream) => ({
      ...upstream,
      apiBaseUrl: normalizeUrl(upstream.apiBaseUrl),
      modelsUrl: normalizeUrl(upstream.modelsUrl),
    }));

  return {
    ...adminSettings,
    upstreams,
    turnstileEnabled: turnstile.enabled,
    turnstileSiteKey: turnstile.siteKey,
    turnstileSecretKey: turnstile.secretKey,
    lastCatalogSyncAt: rawSettings[SETTING_KEYS.lastCatalogSyncAt] ?? null,
    lastProbeAt: rawSettings[SETTING_KEYS.lastProbeAt] ?? null,
    lastProbeStartedAt: rawSettings[SETTING_KEYS.lastProbeStartedAt] ?? null,
    lastProbeFinishedAt: rawSettings[SETTING_KEYS.lastProbeFinishedAt] ?? null,
  };
}

export async function getAdminSettingsResponse(db: D1Database): Promise<AdminSettingsResponse> {
  await ensureBootstrap(db);
  const settings = await getRuntimeSettings(db);
  const upstreams = await listUpstreams(db, false);
  const turnstile: TurnstileAdminConfig = {
    enabled: settings.turnstileEnabled,
    siteKey: settings.turnstileSiteKey,
    secretKeyConfigured: settings.turnstileSecretKey.trim().length > 0,
    secretKeyMasked: maskApiKey(settings.turnstileSecretKey),
  };

  return {
    settings: {
      siteTitle: settings.siteTitle,
      siteSubtitle: settings.siteSubtitle,
      showSummaryCards: settings.showSummaryCards,
      probeIntervalMs: settings.probeIntervalMs,
      catalogSyncIntervalMs: settings.catalogSyncIntervalMs,
      probeTimeoutMs: settings.probeTimeoutMs,
      probeConcurrency: settings.probeConcurrency,
      probeMaxTokens: settings.probeMaxTokens,
      probeTemperature: settings.probeTemperature,
      degradedRetryAttempts: settings.degradedRetryAttempts,
      failedRetryAttempts: settings.failedRetryAttempts,
      modelStatusUpScoreThreshold: settings.modelStatusUpScoreThreshold,
      modelStatusDegradedScoreThreshold: settings.modelStatusDegradedScoreThreshold,
    },
    upstreams: upstreams.map((upstream) => ({
      id: upstream.id,
      name: upstream.name,
      group: upstream.group,
      apiBaseUrl: normalizeUrl(upstream.apiBaseUrl),
      modelsUrl: normalizeUrl(upstream.modelsUrl),
      isActive: upstream.isActive,
      apiKeyConfigured: upstream.apiKey.trim().length > 0,
      apiKeyMasked: maskApiKey(upstream.apiKey),
    })),
    apiKeyConfigured: upstreams.some((upstream) => upstream.apiKey.trim().length > 0),
    turnstile,
  };
}

export async function getAdminLoginConfig(db: D1Database): Promise<TurnstileLoginConfig> {
  await ensureBootstrap(db);
  const rawSettings = await listSettings(db);
  const turnstile = parseTurnstileConfig(rawSettings);

  return {
    enabled: turnstile.enabled && turnstile.siteKey.trim().length > 0 && turnstile.secretKey.trim().length > 0,
    siteKey: turnstile.siteKey,
  };
}

export async function updateAdminSettings(
  db: D1Database,
  updates: Partial<AdminSettings> & { upstreams?: UpstreamInput[]; turnstile?: TurnstileInput },
): Promise<AdminSettingsResponse> {
  await ensureBootstrap(db);
  const currentSettings = await getRuntimeSettings(db);
  const nowIso = new Date().toISOString();

  const nextSettings: AdminSettings = {
    siteTitle: typeof updates.siteTitle === "string" ? updates.siteTitle.trim() || currentSettings.siteTitle : currentSettings.siteTitle,
    siteSubtitle: typeof updates.siteSubtitle === "string" ? updates.siteSubtitle.trim() : currentSettings.siteSubtitle,
    showSummaryCards: typeof updates.showSummaryCards === "boolean" ? updates.showSummaryCards : currentSettings.showSummaryCards,
    probeIntervalMs: clampNumber(updates.probeIntervalMs ?? currentSettings.probeIntervalMs, 60_000, 86_400_000),
    catalogSyncIntervalMs: clampNumber(updates.catalogSyncIntervalMs ?? currentSettings.catalogSyncIntervalMs, 60_000, 86_400_000),
    probeTimeoutMs: clampNumber(updates.probeTimeoutMs ?? currentSettings.probeTimeoutMs, 2_000, 120_000),
    probeConcurrency: clampNumber(updates.probeConcurrency ?? currentSettings.probeConcurrency, 1, 12),
    probeMaxTokens: clampNumber(updates.probeMaxTokens ?? currentSettings.probeMaxTokens, 1, 64),
    probeTemperature: clampNumber(updates.probeTemperature ?? currentSettings.probeTemperature, 0, 2),
    degradedRetryAttempts: clampNumber(updates.degradedRetryAttempts ?? currentSettings.degradedRetryAttempts, 0, 3),
    failedRetryAttempts: clampNumber(updates.failedRetryAttempts ?? currentSettings.failedRetryAttempts, 0, 3),
    modelStatusUpScoreThreshold: clampNumber(
      updates.modelStatusUpScoreThreshold ?? currentSettings.modelStatusUpScoreThreshold,
      0,
      100,
    ),
    modelStatusDegradedScoreThreshold: clampNumber(
      updates.modelStatusDegradedScoreThreshold ?? currentSettings.modelStatusDegradedScoreThreshold,
      0,
      100,
    ),
  };

  const nextTurnstileEnabled = typeof updates.turnstile?.enabled === "boolean"
    ? updates.turnstile.enabled
    : currentSettings.turnstileEnabled;
  const nextTurnstileSiteKey = typeof updates.turnstile?.siteKey === "string"
    ? updates.turnstile.siteKey.trim()
    : currentSettings.turnstileSiteKey;
  const nextTurnstileSecretKey = typeof updates.turnstile?.secretKey === "string" && updates.turnstile.secretKey.trim().length > 0
    ? updates.turnstile.secretKey.trim()
    : currentSettings.turnstileSecretKey;

  if (nextTurnstileEnabled && (!nextTurnstileSiteKey || !nextTurnstileSecretKey)) {
    throw new Error("Turnstile requires both site key and secret key before it can be enabled");
  }

  await setSettingsBatch(
    db,
    [
      { key: SETTING_KEYS.siteTitle, value: nextSettings.siteTitle },
      { key: SETTING_KEYS.siteSubtitle, value: nextSettings.siteSubtitle },
      { key: SETTING_KEYS.showSummaryCards, value: nextSettings.showSummaryCards ? "1" : "0" },
      { key: SETTING_KEYS.probeIntervalMs, value: String(nextSettings.probeIntervalMs) },
      { key: SETTING_KEYS.catalogSyncIntervalMs, value: String(nextSettings.catalogSyncIntervalMs) },
      { key: SETTING_KEYS.probeTimeoutMs, value: String(nextSettings.probeTimeoutMs) },
      { key: SETTING_KEYS.probeConcurrency, value: String(nextSettings.probeConcurrency) },
      { key: SETTING_KEYS.probeMaxTokens, value: String(nextSettings.probeMaxTokens) },
      { key: SETTING_KEYS.probeTemperature, value: String(nextSettings.probeTemperature) },
      { key: SETTING_KEYS.degradedRetryAttempts, value: String(nextSettings.degradedRetryAttempts) },
      { key: SETTING_KEYS.failedRetryAttempts, value: String(nextSettings.failedRetryAttempts) },
      { key: SETTING_KEYS.modelStatusUpScoreThreshold, value: String(nextSettings.modelStatusUpScoreThreshold) },
      { key: SETTING_KEYS.modelStatusDegradedScoreThreshold, value: String(nextSettings.modelStatusDegradedScoreThreshold) },
      { key: SETTING_KEYS.turnstileEnabled, value: nextTurnstileEnabled ? "1" : "0" },
      { key: SETTING_KEYS.turnstileSiteKey, value: nextTurnstileSiteKey },
      { key: SETTING_KEYS.turnstileSecretKey, value: nextTurnstileSecretKey },
    ],
    nowIso,
  );

  if (Array.isArray(updates.upstreams)) {
    const existingUpstreams = await listUpstreams(db, false);
    const keepIds = new Set<string>();

    let fallbackIndex = 1;
    for (const upstream of updates.upstreams) {
      const id = (upstream.id?.trim() || sanitizeUpstreamId(upstream.name, fallbackIndex)).toLowerCase();
      fallbackIndex += 1;
      keepIds.add(id);

      const existing = existingUpstreams.find((candidate) => candidate.id === id);
      await upsertUpstream(db, {
        id,
        name: upstream.name.trim() || `Upstream ${fallbackIndex}`,
        group: upstream.group?.trim() || existing?.group || "default",
        apiBaseUrl: normalizeUrl(upstream.apiBaseUrl),
        modelsUrl: normalizeUrl(upstream.modelsUrl),
        apiKey: typeof upstream.apiKey === "string" && upstream.apiKey.trim().length > 0
          ? upstream.apiKey.trim()
          : existing?.apiKey ?? "",
        isActive: upstream.isActive ?? true,
        updatedAt: nowIso,
      });
    }

    const deleteIds = existingUpstreams
      .map((upstream) => upstream.id)
      .filter((id) => !keepIds.has(id));

    await deleteUpstreamsByIds(db, deleteIds);
  }

  return getAdminSettingsResponse(db);
}
