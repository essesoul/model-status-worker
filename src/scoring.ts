export type ProbeScoreInput = {
  success: boolean;
  connectivityLatencyMs?: number | null | undefined;
  firstTokenLatencyMs?: number | null | undefined;
  totalLatencyMs: number;
};

const CONNECTIVITY_CAP_MS = 8_000;
const FIRST_TOKEN_CAP_MS = 15_000;
const TOTAL_CAP_MS = 30_000;

export function scoreProbeLatency(probe: ProbeScoreInput): number {
  if (!probe.success) {
    return 0;
  }

  const connectivityPenalty = Math.min(probe.connectivityLatencyMs ?? CONNECTIVITY_CAP_MS, CONNECTIVITY_CAP_MS) / CONNECTIVITY_CAP_MS;
  const firstTokenPenalty = Math.min(probe.firstTokenLatencyMs ?? probe.totalLatencyMs, FIRST_TOKEN_CAP_MS) / FIRST_TOKEN_CAP_MS;
  const totalPenalty = Math.min(probe.totalLatencyMs, TOTAL_CAP_MS) / TOTAL_CAP_MS;
  const blendedPenalty = connectivityPenalty * 0.45 + firstTokenPenalty * 0.35 + totalPenalty * 0.2;

  return Math.max(0, Math.round((1 - blendedPenalty) * 100));
}
