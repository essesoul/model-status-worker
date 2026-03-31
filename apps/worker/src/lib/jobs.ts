import type { ProbeAttemptResult } from "@model-status/shared";

import {
  SETTING_KEYS,
  type RuntimeSettings,
  deactivateMissingModels,
  ensureBootstrap,
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

function normalizeCatalogModels(payload: unknown): CatalogModel[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
      ? (payload as { data: unknown[] }).data
      : [];

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
  return Array.isArray(record.choices) || typeof record.content === "string";
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
    response = await fetch(`${upstream.apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${upstream.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: settings.probeMaxTokens,
        temperature: settings.probeTemperature,
        messages: [{ role: "user", content: PROBE_PROMPT }],
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

function scoreResult(result: ProbeAttemptResult): number {
  if (!result.success) {
    return 0;
  }

  const connectivityPenalty = Math.min(result.connectivityLatencyMs ?? 1500, 1500) / 1500;
  const totalPenalty = Math.min(result.totalLatencyMs, 5000) / 5000;
  const blendedPenalty = connectivityPenalty * 0.55 + totalPenalty * 0.45;
  return Math.max(0, Math.round((1 - blendedPenalty) * 100));
}

async function runProbeWithRetries(
  model: string,
  upstream: RuntimeSettings["upstreams"][number],
  settings: RuntimeSettings,
): Promise<ProbeAttemptResult> {
  let bestResult: ProbeAttemptResult | null = null;
  let bestScore = -1;
  let degradedRetriesLeft = Math.max(0, settings.degradedRetryAttempts);
  let failedRetriesLeft = Math.max(0, settings.failedRetryAttempts);

  while (true) {
    const result = await runSingleProbe(model, upstream, settings);
    const currentScore = scoreResult(result);
    if (!bestResult || currentScore > bestScore) {
      bestResult = result;
      bestScore = currentScore;
    }

    const isHealthy = result.success && currentScore >= settings.modelStatusUpScoreThreshold;
    const isDegraded = result.success
      && currentScore >= settings.modelStatusDegradedScoreThreshold
      && currentScore < settings.modelStatusUpScoreThreshold;

    if (isHealthy) {
      break;
    }

    if (isDegraded && degradedRetriesLeft > 0) {
      degradedRetriesLeft -= 1;
      continue;
    }

    if (!result.success && failedRetriesLeft > 0) {
      failedRetriesLeft -= 1;
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

    await deactivateMissingModels(
      db,
      upstream.id,
      models.map((model) => model.id),
      syncedAt,
    );
  }

  await setSetting(db, SETTING_KEYS.lastCatalogSyncAt, syncedAt, syncedAt);

  return {
    syncedAt,
    totalFetched,
    upserted: totalFetched,
    errors,
  };
}

export async function probeAllModels(db: D1Database): Promise<ProbeCycleResult> {
  await ensureBootstrap(db);
  const settings = await getRuntimeSettings(db);
  const activeModels = (await listModels(db, true)).filter((model) =>
    settings.upstreams.some((upstream) => upstream.id === model.upstreamId),
  );
  const startedAt = new Date().toISOString();

  await setSetting(db, SETTING_KEYS.lastProbeStartedAt, startedAt, startedAt);

  let succeeded = 0;
  let failed = 0;

  const tasks = activeModels
    .map((model) => ({
      model: model.id,
      upstream: settings.upstreams.find((upstream) => upstream.id === model.upstreamId),
    }))
    .filter((task): task is { model: string; upstream: RuntimeSettings["upstreams"][number] } => Boolean(task.upstream));

  await runWithConcurrency(tasks, settings.probeConcurrency, async (task) => {
    const result = await runProbeWithRetries(task.model, task.upstream, settings);
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

  return {
    startedAt,
    finishedAt,
    total: tasks.length,
    succeeded,
    failed,
  };
}

export async function runDueJobs(db: D1Database): Promise<void> {
  await ensureBootstrap(db);
  let settings = await getRuntimeSettings(db);
  const nowMs = Date.now();

  if (shouldRun(settings.lastCatalogSyncAt, settings.catalogSyncIntervalMs, nowMs)) {
    await syncModelCatalog(db);
    settings = await getRuntimeSettings(db);
  }

  if (shouldRun(settings.lastProbeAt, settings.probeIntervalMs, nowMs)) {
    await probeAllModels(db);
  }
}
