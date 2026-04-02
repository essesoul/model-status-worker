import type { ProbeAttemptResult, ProbeStreamEvent } from "./shared";
import { scoreProbeLatency } from "./scoring";

import {
  SETTING_KEYS,
  type RuntimeSettings,
  deleteModelsByKeys,
  deleteProbesStartedBefore,
  ensureBootstrap,
  getOutdatedProbeCutoffIso,
  getRuntimeSettings,
  insertProbe,
  listModels,
  setSetting,
  upsertModel,
} from "./store";

const PROBE_PROMPT = 'Respond with exactly: "ok"';

type CatalogModel = {
  id: string;
  created?: number;
  owned_by?: string;
};

type SyncResult = {
  syncedAt: string;
  totalFetched: number;
  upserted: number;
  errors: string[];
};

type ProbeCycleResult = {
  startedAt: string;
  finishedAt: string;
  total: number;
  succeeded: number;
  failed: number;
};

type ProbeReporter = (event: ProbeStreamEvent) => Promise<void> | void;
let dueJobsRun: Promise<void> | null = null;

function truncateText(value: string | undefined, maxLength = 4000): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function previewErrorBody(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length <= 240 ? trimmed : `${trimmed.slice(0, 240)}...`;
}

function normalizeCatalogModels(payload: unknown): CatalogModel[] | null {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
      ? (payload as { data: unknown[] }).data
      : null;

  if (!list) {
    return null;
  }

  return list.reduce<CatalogModel[]>((accumulator, entry) => {
      if (!entry || typeof entry !== "object") {
        return accumulator;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (!id) {
        return accumulator;
      }

      accumulator.push({
        id,
        created: typeof record.created === "number" && Number.isFinite(record.created) ? Math.trunc(record.created) : undefined,
        owned_by: typeof record.owned_by === "string" ? record.owned_by : undefined,
      });
      return accumulator;
    }, []);
}

function parseSsePayloads(buffer: string): { payloads: string[]; remainder: string } {
  const events = buffer.replace(/\r\n/gu, "\n").split("\n\n");
  const remainder = events.pop() ?? "";
  const payloads = events.flatMap((event) =>
    event
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean),
  );

  return { payloads, remainder };
}

function extractContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";

  if (type === "response.output_text.delta" && typeof record.delta === "string" && record.delta.length > 0) {
    return record.delta;
  }

  if (type === "response.output_text.done" && typeof record.text === "string" && record.text.length > 0) {
    return record.text;
  }

  if (typeof record.output_text === "string" && record.output_text.length > 0) {
    return record.output_text;
  }

  const output = Array.isArray(record.output) ? record.output : [];
  for (const entry of output) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const content = Array.isArray((entry as { content?: unknown[] }).content) ? (entry as { content: unknown[] }).content : [];
    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const partRecord = part as Record<string, unknown>;
      if (partRecord.type === "output_text" && typeof partRecord.text === "string" && partRecord.text.length > 0) {
        return partRecord.text;
      }
    }
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0];

  if (firstChoice && typeof firstChoice === "object") {
    const choice = firstChoice as Record<string, unknown>;
    const delta = choice.delta;

    if (delta && typeof delta === "object") {
      const content = (delta as Record<string, unknown>).content;
      if (typeof content === "string" && content.length > 0) {
        return content;
      }
    }

    const text = choice.text;
    if (typeof text === "string" && text.length > 0) {
      return text;
    }
  }

  const content = record.content;
  return typeof content === "string" && content.length > 0 ? content : null;
}

function isParseableCompletionPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  return type.startsWith("response.")
    || type === "error"
    || Array.isArray(record.output)
    || Array.isArray(record.choices)
    || typeof record.content === "string"
    || typeof record.output_text === "string";
}

function extractStreamError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";

  if (type === "error") {
    const error = record.error;
    if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }

    if (typeof record.message === "string") {
      return record.message;
    }
  }

  if (type === "response.failed") {
    const response = record.response;
    if (response && typeof response === "object") {
      const error = (response as { error?: unknown }).error;
      if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
        return (error as { message: string }).message;
      }
    }
  }

  return null;
}

async function runSingleProbe(
  model: string,
  upstream: RuntimeSettings["upstreams"][number],
  settings: RuntimeSettings,
): Promise<ProbeAttemptResult> {
  const startedAtDate = new Date();
  const startedAtPerf = performance.now();
  let response: Response;

  try {
    response = await fetch(`${upstream.apiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${upstream.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_output_tokens: settings.probeMaxTokens,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: PROBE_PROMPT,
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(settings.probeTimeoutMs),
    });
  } catch (error) {
    const completedAt = new Date();
    return {
      upstreamId: upstream.id,
      upstreamName: upstream.name,
      model,
      startedAt: startedAtDate.toISOString(),
      completedAt: completedAt.toISOString(),
      success: false,
      error: error instanceof Error ? error.message : "Unknown fetch error",
      totalLatencyMs: Math.round(performance.now() - startedAtPerf),
    };
  }

  const connectivityLatencyMs = Math.round(performance.now() - startedAtPerf);

  if (!response.ok) {
    const rawResponseText = await response.text();
    const completedAt = new Date();
    return {
      upstreamId: upstream.id,
      upstreamName: upstream.name,
      model,
      startedAt: startedAtDate.toISOString(),
      completedAt: completedAt.toISOString(),
      success: false,
      statusCode: response.status,
      error: `Upstream returned status ${response.status}`,
      connectivityLatencyMs,
      totalLatencyMs: Math.round(performance.now() - startedAtPerf),
      rawResponseText: truncateText(rawResponseText),
    };
  }

  let firstTokenLatencyMs: number | undefined;
  let rawResponseText = "";
  let sseBuffer = "";
  let parsedPayloadSeen = false;
  let contentSeen = false;
  let streamError: string | null = null;

  try {
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          rawResponseText += decoder.decode();
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        rawResponseText += chunk;
        sseBuffer += chunk;

        const { payloads, remainder } = parseSsePayloads(sseBuffer);
        sseBuffer = remainder;

        for (const payload of payloads) {
          if (payload === "[DONE]") {
            continue;
          }

          try {
            const parsed = JSON.parse(payload) as unknown;
            const errorMessage = extractStreamError(parsed);
            if (errorMessage) {
              streamError = errorMessage;
            }
            parsedPayloadSeen = parsedPayloadSeen || isParseableCompletionPayload(parsed);
            const content = extractContent(parsed);
            if (content) {
              contentSeen = true;
            }
            if (firstTokenLatencyMs === undefined && content) {
              firstTokenLatencyMs = Math.round(performance.now() - startedAtPerf);
            }
          } catch {
            // Ignore provider-specific payload fragments.
          }
        }

        if (streamError) {
          break;
        }
      }
    }
  } catch (error) {
    const completedAt = new Date();
    return {
      upstreamId: upstream.id,
      upstreamName: upstream.name,
      model,
      startedAt: startedAtDate.toISOString(),
      completedAt: completedAt.toISOString(),
      success: false,
      statusCode: response.status,
      connectivityLatencyMs,
      totalLatencyMs: Math.round(performance.now() - startedAtPerf),
      error: error instanceof Error ? error.message : "Unknown stream read error",
      rawResponseText: truncateText(rawResponseText),
    };
  }

  const completedAt = new Date();

  if (!parsedPayloadSeen && rawResponseText.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawResponseText) as unknown;
      const errorMessage = extractStreamError(parsed);
      if (errorMessage) {
        streamError = errorMessage;
      }
      parsedPayloadSeen = isParseableCompletionPayload(parsed);
      contentSeen = Boolean(extractContent(parsed));
    } catch {
      // Ignore non-JSON fallback bodies.
    }
  }

  if (streamError) {
    return {
      upstreamId: upstream.id,
      upstreamName: upstream.name,
      model,
      startedAt: startedAtDate.toISOString(),
      completedAt: completedAt.toISOString(),
      success: false,
      statusCode: response.status,
      connectivityLatencyMs,
      totalLatencyMs: Math.round(performance.now() - startedAtPerf),
      error: streamError,
      rawResponseText: truncateText(rawResponseText),
    };
  }

  if (!parsedPayloadSeen || !contentSeen) {
    return {
      upstreamId: upstream.id,
      upstreamName: upstream.name,
      model,
      startedAt: startedAtDate.toISOString(),
      completedAt: completedAt.toISOString(),
      success: false,
      statusCode: response.status,
      connectivityLatencyMs,
      totalLatencyMs: Math.round(performance.now() - startedAtPerf),
      error: !parsedPayloadSeen
        ? "Upstream stream did not contain a parseable completion payload"
        : "Upstream stream completed without content tokens",
      rawResponseText: truncateText(rawResponseText),
    };
  }

  return {
    upstreamId: upstream.id,
    upstreamName: upstream.name,
    model,
    startedAt: startedAtDate.toISOString(),
    completedAt: completedAt.toISOString(),
    success: true,
    statusCode: response.status,
    connectivityLatencyMs,
    firstTokenLatencyMs,
    totalLatencyMs: Math.round(performance.now() - startedAtPerf),
    rawResponseText: truncateText(rawResponseText),
  };
}

function classifySuccessfulProbe(score: number, settings: RuntimeSettings): "up" | "degraded" {
  return score >= settings.modelStatusUpScoreThreshold ? "up" : "degraded";
}

async function runProbeWithRetries(
  model: string,
  upstream: RuntimeSettings["upstreams"][number],
  settings: RuntimeSettings,
  reporter?: ProbeReporter,
): Promise<ProbeAttemptResult> {
  let bestResult: ProbeAttemptResult | null = null;
  let bestScore = -1;
  let degradedRetriesLeft = Math.max(0, settings.degradedRetryAttempts);
  let failedRetriesLeft = Math.max(0, settings.failedRetryAttempts);
  let attempt = 1;

  while (true) {
    await reporter?.({
      type: "attempt-started",
      startedAt: new Date().toISOString(),
      upstreamId: upstream.id,
      upstreamName: upstream.name,
      model,
      attempt,
    });

    const result = await runSingleProbe(model, upstream, settings);
    const currentScore = scoreProbeLatency(result);
    if (!bestResult || currentScore > bestScore) {
      bestResult = result;
      bestScore = currentScore;
    }

    const isHealthy = result.success && currentScore >= settings.modelStatusUpScoreThreshold;
    const isDegraded = result.success && currentScore < settings.modelStatusUpScoreThreshold;

    await reporter?.({
      type: "attempt-finished",
      finishedAt: new Date().toISOString(),
      upstreamId: upstream.id,
      upstreamName: upstream.name,
      model,
      attempt,
      result: {
        success: result.success,
        statusCode: result.statusCode ?? null,
        error: result.error ?? null,
        connectivityLatencyMs: result.connectivityLatencyMs ?? null,
        firstTokenLatencyMs: result.firstTokenLatencyMs ?? null,
        totalLatencyMs: result.totalLatencyMs,
      },
      score: currentScore,
      classification: result.success ? classifySuccessfulProbe(currentScore, settings) : "down",
    });

    if (isHealthy) {
      break;
    }

    if (isDegraded && degradedRetriesLeft > 0) {
      degradedRetriesLeft -= 1;
      attempt += 1;
      continue;
    }

    if (!result.success && failedRetriesLeft > 0) {
      failedRetriesLeft -= 1;
      attempt += 1;
      continue;
    }

    break;
  }

  return bestResult as ProbeAttemptResult;
}

async function runWithConcurrency<T>(
  tasks: T[],
  limit: number,
  worker: (task: T) => Promise<void>,
): Promise<void> {
  const queue = [...tasks];
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task === undefined) {
        return;
      }
      await worker(task);
    }
  });

  await Promise.all(runners);
}

function shouldRun(lastRunAt: string | null, intervalMs: number, nowMs = Date.now()): boolean {
  if (intervalMs <= 0) {
    return false;
  }

  if (!lastRunAt) {
    return true;
  }

  const lastRunMs = Date.parse(lastRunAt);
  if (Number.isNaN(lastRunMs)) {
    return true;
  }

  return nowMs - lastRunMs >= intervalMs;
}

export async function syncModelCatalog(db: D1Database): Promise<SyncResult> {
  await ensureBootstrap(db);
  const settings = await getRuntimeSettings(db);
  const existingModels = await listModels(db, false);
  const existingModelsByUpstream = existingModels.reduce<Map<string, Array<{ upstreamId: string; id: string }>>>(
    (accumulator, model) => {
      const records = accumulator.get(model.upstreamId) ?? [];
      records.push({
        upstreamId: model.upstreamId,
        id: model.id,
      });
      accumulator.set(model.upstreamId, records);
      return accumulator;
    },
    new Map(),
  );
  const syncedAt = new Date().toISOString();
  const errors: string[] = [];
  let totalFetched = 0;

  for (const upstream of settings.upstreams) {
    let response: Response;

    try {
      response = await fetch(upstream.modelsUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${upstream.apiKey}`,
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      errors.push(`Models sync failed for ${upstream.name}: ${error instanceof Error ? error.message : "Unknown fetch error"}`);
      continue;
    }

    if (!response.ok) {
      const rawResponseText = await response.text();
      const bodyPreview = previewErrorBody(rawResponseText);
      errors.push(
        bodyPreview
          ? `Models sync failed for ${upstream.name}: HTTP ${response.status}. Response: ${bodyPreview}`
          : `Models sync failed for ${upstream.name}: HTTP ${response.status}.`,
      );
      continue;
    }

    const json = await response.json<unknown>();
    const models = normalizeCatalogModels(json);
    if (!models) {
      errors.push(`Models sync failed for ${upstream.name}: Invalid catalog payload.`);
      continue;
    }

    totalFetched += models.length;

    for (const model of models) {
      await upsertModel(db, {
        upstreamId: upstream.id,
        id: model.id,
        created: model.created ?? null,
        ownedBy: model.owned_by ?? null,
        displayName: null,
        icon: null,
        isVisible: true,
        sortOrder: 0,
        syncedAt,
        isActive: true,
      });
    }

    const activeModelIds = new Set(models.map((model) => model.id));
    const deleteKeys = (existingModelsByUpstream.get(upstream.id) ?? []).filter((model) => !activeModelIds.has(model.id));
    await deleteModelsByKeys(db, deleteKeys);
  }

  await setSetting(db, SETTING_KEYS.lastCatalogSyncAt, syncedAt, syncedAt);

  return {
    syncedAt,
    totalFetched,
    upserted: totalFetched,
    errors,
  };
}

export async function cleanupOutdatedProbeData(
  db: D1Database,
): Promise<{ cutoffIso: string; deletedProbeCount: number }> {
  await ensureBootstrap(db);
  const cutoffIso = getOutdatedProbeCutoffIso();
  const deletedProbeCount = await deleteProbesStartedBefore(db, cutoffIso);

  return {
    cutoffIso,
    deletedProbeCount,
  };
}

export async function probeAllModels(db: D1Database, reporter?: ProbeReporter): Promise<ProbeCycleResult> {
  await ensureBootstrap(db);
  const settings = await getRuntimeSettings(db);
  const activeModels = (await listModels(db, true)).filter((model) =>
    settings.upstreams.some((upstream) => upstream.id === model.upstreamId),
  );
  const startedAt = new Date().toISOString();

  await setSetting(db, SETTING_KEYS.lastProbeStartedAt, startedAt, startedAt);
  await reporter?.({
    type: "cycle-started",
    startedAt,
    total: activeModels.length,
  });

  let succeeded = 0;
  let failed = 0;

  const tasks = activeModels
    .map((model) => ({
      model: model.id,
      upstream: settings.upstreams.find((upstream) => upstream.id === model.upstreamId),
    }))
    .filter((task): task is { model: string; upstream: RuntimeSettings["upstreams"][number] } => Boolean(task.upstream));

  await runWithConcurrency(tasks, settings.probeConcurrency, async (task) => {
    const result = await runProbeWithRetries(task.model, task.upstream, settings, reporter);
    await insertProbe(db, result);
    if (result.success) {
      succeeded += 1;
    } else {
      failed += 1;
    }
  });

  const finishedAt = new Date().toISOString();
  await setSetting(db, SETTING_KEYS.lastProbeAt, finishedAt, finishedAt);
  await setSetting(db, SETTING_KEYS.lastProbeFinishedAt, finishedAt, finishedAt);

  await reporter?.({
    type: "cycle-finished",
    startedAt,
    finishedAt,
    total: tasks.length,
    succeeded,
    failed,
  });

  return {
    startedAt,
    finishedAt,
    total: tasks.length,
    succeeded,
    failed,
  };
}

export async function runDueJobs(db: D1Database): Promise<void> {
  if (dueJobsRun) {
    console.info("Scheduled jobs are already running; skipping overlapping trigger.");
    return dueJobsRun;
  }

  dueJobsRun = (async () => {
    await ensureBootstrap(db);
    let settings = await getRuntimeSettings(db);
    const nowMs = Date.now();
    const shouldSyncCatalog = shouldRun(settings.lastCatalogSyncAt, settings.catalogSyncIntervalMs, nowMs);
    const shouldProbeModels = shouldRun(settings.lastProbeAt, settings.probeIntervalMs, nowMs);

    console.info("Scheduled job evaluation", {
      now: new Date(nowMs).toISOString(),
      lastCatalogSyncAt: settings.lastCatalogSyncAt,
      catalogSyncIntervalMs: settings.catalogSyncIntervalMs,
      shouldSyncCatalog,
      lastProbeAt: settings.lastProbeAt,
      probeIntervalMs: settings.probeIntervalMs,
      shouldProbeModels,
    });

    if (shouldSyncCatalog) {
      const syncResult = await syncModelCatalog(db);
      console.info("Scheduled catalog sync completed", {
        syncedAt: syncResult.syncedAt,
        totalFetched: syncResult.totalFetched,
        upserted: syncResult.upserted,
        warnings: syncResult.errors.length,
      });
      settings = await getRuntimeSettings(db);
    }

    if (shouldProbeModels) {
      const probeResult = await probeAllModels(db);
      console.info("Scheduled probe cycle completed", {
        startedAt: probeResult.startedAt,
        finishedAt: probeResult.finishedAt,
        total: probeResult.total,
        succeeded: probeResult.succeeded,
        failed: probeResult.failed,
      });
    }
  })();

  try {
    await dueJobsRun;
  } finally {
    dueJobsRun = null;
  }
}
