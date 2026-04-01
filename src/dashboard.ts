import type {
  AdminDashboardResponse,
  DashboardRange,
  DashboardSummary,
  ModelSummary,
  ProbeStatusSample,
} from "./shared";
import { scoreProbeLatency } from "./scoring";
import { rangeStartIso } from "./shared";

import {
  type ModelRecord,
  type ProbeRecord,
  type RuntimeSettings,
  listModels,
  listProbesSince,
  listUpstreams,
} from "./store";

const RANGE_BUCKET_COUNT: Record<DashboardRange, number> = {
  "90m": 90,
  "24h": 24,
  "7d": 7,
  "30d": 30,
};

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }

  return Number(((numerator / denominator) * 100).toFixed(2));
}

function scoreProbe(
  probe: Pick<ProbeRecord, "success" | "connectivityLatencyMs" | "firstTokenLatencyMs" | "totalLatencyMs">,
): number {
  return scoreProbeLatency(probe);
}

function isSuccessfulProbe(
  probe: Pick<ProbeRecord, "success">,
): boolean {
  return probe.success;
}

function classifyProbeLevel(
  probe: Pick<ProbeRecord, "success" | "connectivityLatencyMs" | "firstTokenLatencyMs" | "totalLatencyMs">,
  settings: RuntimeSettings,
): ProbeStatusSample["level"] {
  if (!probe.success) {
    return "down";
  }

  const score = scoreProbe(probe);
  if (score >= settings.modelStatusUpScoreThreshold) {
    return "up";
  }

  return "degraded";
}

function classifyBucket(
  score: number | null,
  probeCount: number,
  successCount: number,
  settings: RuntimeSettings,
): ProbeStatusSample["level"] {
  if (score === null) {
    return "empty";
  }

  if (probeCount > 0 && successCount === 0) {
    return "down";
  }

  if (score >= settings.modelStatusUpScoreThreshold) {
    return "up";
  }

  return "degraded";
}

function buildProbeSample(
  probe: ProbeRecord,
  settings: RuntimeSettings,
): ProbeStatusSample {
  const score = scoreProbe(probe);

  return {
    id: `${probe.upstreamId}:${probe.model}:${probe.startedAt}`,
    startedAt: probe.startedAt,
    endedAt: probe.completedAt,
    score,
    level: classifyProbeLevel(probe, settings),
    probeCount: 1,
    successCount: isSuccessfulProbe(probe) ? 1 : 0,
    avgConnectivityLatencyMs: probe.connectivityLatencyMs,
    avgTotalLatencyMs: probe.totalLatencyMs,
  };
}

function buildEmptySample(id: string, startedAt: string, endedAt: string): ProbeStatusSample {
  return {
    id,
    startedAt,
    endedAt,
    score: null,
    level: "empty",
    probeCount: 0,
    successCount: 0,
    avgConnectivityLatencyMs: null,
    avgTotalLatencyMs: null,
  };
}

function buildRecentStatuses(
  range: DashboardRange,
  probes: ProbeRecord[],
  toDate: Date,
  settings: RuntimeSettings,
): ProbeStatusSample[] {
  const fromMs = Date.parse(rangeStartIso(range, toDate));
  const toMs = toDate.getTime();
  const bucketCount = range === "90m"
    ? Math.max(1, Math.min(RANGE_BUCKET_COUNT[range], Math.ceil((90 * 60 * 1000) / settings.probeIntervalMs)))
    : RANGE_BUCKET_COUNT[range];

  if (range === "90m") {
    const sortedProbes = [...probes]
      .filter((probe) => {
        const probeMs = Date.parse(probe.startedAt);
        return probeMs >= fromMs && probeMs <= toMs;
      })
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));

    const recentSamples = sortedProbes.slice(-bucketCount).map((probe) => buildProbeSample(probe, settings));
    if (recentSamples.length >= bucketCount) {
      return recentSamples;
    }

    const missingCount = bucketCount - recentSamples.length;
    const padding = Array.from({ length: missingCount }, (_, index) => {
      const bucketStartMs = fromMs + index * settings.probeIntervalMs;
      const bucketEndMs = Math.min(bucketStartMs + settings.probeIntervalMs, toMs);
      return buildEmptySample(
        `${range}-empty-${bucketStartMs}`,
        new Date(bucketStartMs).toISOString(),
        new Date(bucketEndMs).toISOString(),
      );
    });

    return [...padding, ...recentSamples];
  }

  const bucketMs = Math.max(1, Math.floor((toMs - fromMs) / bucketCount));

  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketStartMs = fromMs + index * bucketMs;
    const bucketEndMs = index === bucketCount - 1 ? toMs : bucketStartMs + bucketMs;
    const bucketProbes = probes.filter((probe) => {
      const probeMs = Date.parse(probe.startedAt);
      return probeMs >= bucketStartMs && probeMs < bucketEndMs;
    });
    const scores = bucketProbes.map(scoreProbe);
    const score = scores.length > 0 ? average(scores) : null;
    const successCount = bucketProbes.filter((probe) => isSuccessfulProbe(probe)).length;
    const connectivity = bucketProbes
      .map((probe) => probe.connectivityLatencyMs)
      .filter((value): value is number => value !== null);
    const total = bucketProbes.map((probe) => probe.totalLatencyMs);

    return {
      id: `${range}-${bucketStartMs}`,
      startedAt: new Date(bucketStartMs).toISOString(),
      endedAt: new Date(bucketEndMs).toISOString(),
      score,
      level: classifyBucket(score, bucketProbes.length, successCount, settings),
      probeCount: bucketProbes.length,
      successCount,
      avgConnectivityLatencyMs: average(connectivity),
      avgTotalLatencyMs: average(total),
    };
  });
}

function summarizeModel(
  modelRecord: ModelRecord,
  upstreamName: string,
  upstreamGroup: string,
  probes: ProbeRecord[],
  range: DashboardRange,
  toDate: Date,
  settings: RuntimeSettings,
): ModelSummary {
  const successes = probes.filter((probe) => isSuccessfulProbe(probe)).length;
  const failures = probes.length - successes;
  const connectivity = probes
    .map((probe) => probe.connectivityLatencyMs)
    .filter((value): value is number => value !== null);
  const firstToken = probes
    .map((probe) => probe.firstTokenLatencyMs)
    .filter((value): value is number => value !== null);
  const total = probes.map((probe) => probe.totalLatencyMs);
  const sortedByStartedAt = [...probes].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const recentStatuses = buildRecentStatuses(range, probes, toDate, settings);
  const latestStatus = [...recentStatuses].reverse().find((status) => status.level !== "empty")?.level ?? "empty";

  return {
    upstreamId: modelRecord.upstreamId,
    upstreamName,
    upstreamGroup,
    model: modelRecord.id,
    displayName: modelRecord.displayName,
    icon: modelRecord.icon,
    isVisible: modelRecord.isVisible,
    sortOrder: modelRecord.sortOrder,
    created: modelRecord.created,
    ownedBy: modelRecord.ownedBy,
    probes: probes.length,
    successes,
    failures,
    availabilityPercentage: percentage(successes, probes.length),
    avgConnectivityLatencyMs: average(connectivity),
    avgFirstTokenLatencyMs: average(firstToken),
    avgTotalLatencyMs: average(total),
    lastProbeAt: sortedByStartedAt[0]?.startedAt ?? null,
    latestStatus,
    recentStatuses,
  };
}

function buildSummary(models: ModelSummary[], hiddenModels: number, lastProbeAt: string | null): DashboardSummary {
  const visibleModels = models.length;
  const availableModels = models.filter((model) => model.latestStatus === "up").length;
  const degradedModels = models.filter((model) => model.latestStatus === "degraded").length;
  const errorModels = models.filter((model) => model.latestStatus === "down").length;
  const availability = models.map((model) => model.availabilityPercentage);
  const connectivity = models
    .map((model) => model.avgConnectivityLatencyMs)
    .filter((value): value is number => value !== null);
  const firstToken = models
    .map((model) => model.avgFirstTokenLatencyMs)
    .filter((value): value is number => value !== null);
  const total = models
    .map((model) => model.avgTotalLatencyMs)
    .filter((value): value is number => value !== null);

  return {
    totalModels: visibleModels,
    availableModels,
    degradedModels,
    errorModels,
    hiddenModels,
    availabilityPercentage: average(availability) ?? 0,
    avgConnectivityLatencyMs: average(connectivity),
    avgFirstTokenLatencyMs: average(firstToken),
    avgTotalLatencyMs: average(total),
    lastProbeAt,
  };
}

function inferIsProbeCycleRunning(settings: RuntimeSettings, now = Date.now()): boolean {
  if (!settings.lastProbeStartedAt) {
    return false;
  }

  const startedAtMs = Date.parse(settings.lastProbeStartedAt);
  const finishedAtMs = settings.lastProbeFinishedAt ? Date.parse(settings.lastProbeFinishedAt) : 0;
  if (Number.isNaN(startedAtMs)) {
    return false;
  }

  return startedAtMs > finishedAtMs && now - startedAtMs < Math.max(settings.probeTimeoutMs * 3, 30 * 60_000);
}

function getNextProbeAt(settings: RuntimeSettings): string | null {
  if (!settings.lastProbeAt) {
    return null;
  }

  const baseMs = Date.parse(settings.lastProbeAt);
  if (Number.isNaN(baseMs)) {
    return null;
  }

  return new Date(baseMs + settings.probeIntervalMs).toISOString();
}

export async function getDashboardData(
  db: D1Database,
  range: DashboardRange,
  settings: RuntimeSettings,
  visibleOnly: boolean,
): Promise<AdminDashboardResponse> {
  const toDate = new Date();
  const fromIso = rangeStartIso(range, toDate);
  const [probes, models, upstreams] = await Promise.all([
    listProbesSince(db, fromIso),
    listModels(db, true),
    listUpstreams(db, true),
  ]);

  const activeModels = visibleOnly ? models.filter((model) => model.isVisible) : models;
  const hiddenModels = visibleOnly ? 0 : models.filter((model) => !model.isVisible).length;
  const upstreamById = new Map(upstreams.map((upstream) => [upstream.id, upstream]));
  const probesByModel = new Map<string, ProbeRecord[]>();

  for (const probe of probes) {
    const key = `${probe.upstreamId}::${probe.model}`;
    const list = probesByModel.get(key) ?? [];
    list.push(probe);
    probesByModel.set(key, list);
  }

  const modelSummaries = activeModels
    .map((model) =>
      summarizeModel(
        model,
        upstreamById.get(model.upstreamId)?.name ?? model.upstreamId,
        upstreamById.get(model.upstreamId)?.group ?? "default",
        probesByModel.get(`${model.upstreamId}::${model.id}`) ?? [],
        range,
        toDate,
        settings,
      ),
    )
    .sort((left, right) => {
      const upstreamComparison = `${left.upstreamGroup}/${left.upstreamName}`.localeCompare(`${right.upstreamGroup}/${right.upstreamName}`);
      if (upstreamComparison !== 0) {
        return upstreamComparison;
      }

      const orderComparison = left.sortOrder - right.sortOrder;
      if (orderComparison !== 0) {
        return orderComparison;
      }

      return (left.displayName ?? left.model).localeCompare(right.displayName ?? right.model);
    });

  return {
    meta: {
      siteTitle: settings.siteTitle,
      siteSubtitle: settings.siteSubtitle,
      range,
      generatedAt: toDate.toISOString(),
      nextProbeAt: getNextProbeAt(settings),
      lastProbeAt: settings.lastProbeAt,
      lastCatalogSyncAt: settings.lastCatalogSyncAt,
      probeIntervalMs: settings.probeIntervalMs,
      isProbeCycleRunning: inferIsProbeCycleRunning(settings, toDate.getTime()),
      showSummaryCards: settings.showSummaryCards,
    },
    summary: buildSummary(modelSummaries, hiddenModels, settings.lastProbeAt),
    models: modelSummaries,
  };
}
