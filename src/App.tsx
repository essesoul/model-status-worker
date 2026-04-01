import type {
  AdminActionResponse,
  AdminDashboardResponse,
  AdminSessionResponse,
  AdminSettingsResponse,
  DashboardRange,
  DashboardResponse,
  ModelSummary,
  ProbeStreamEvent,
  ProbeStatusSample,
  UpstreamView,
} from "./shared";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchAdminDashboard,
  fetchAdminSession,
  fetchAdminSettings,
  fetchDashboard,
  loginAdmin,
  logoutAdmin,
  saveAdminModels,
  saveAdminSettings,
  streamProbeLogs,
  syncCatalogNow,
  type AdminModelsPayload,
  type LoginPayload,
  type ProbeStreamMessage,
  type UpstreamPayload,
} from "./api";
import {
  detectBrowserLocale,
  getMessages,
  localizeRuntimeMessage,
  resolveSystemTitle,
  statusLabel as localizedStatusLabel,
  type Locale,
  type Messages,
} from "./i18n";

type Route = "public" | "admin";
type NoticeTone = "success" | "error";
type ProbeModalStatus = "running" | "finished" | "failed";
type ProbeLogEntryTone = "info" | "success" | "error";

type EditableUpstream = UpstreamView & {
  newApiKey: string;
};

type EditableModel = AdminDashboardResponse["models"][number];
type ProbeLogEntry = {
  id: string;
  tone: ProbeLogEntryTone;
  message: string;
};

type ProbeModalState = {
  open: boolean;
  status: ProbeModalStatus;
  logs: ProbeLogEntry[];
};

type PublicTimelineUnit = "hours" | "days";

type TurnstileWidgetProps = {
  enabled: boolean;
  siteKey: string;
  resetNonce: number;
  onTokenChange: (token: string | null) => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

function getRoute(): Route {
  return window.location.pathname.startsWith("/admin") ? "admin" : "public";
}

function intlLocale(locale: Locale): string {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}

function formatLatency(value: number | null, locale: Locale, copy: Messages): string {
  if (value === null) {
    return copy.emptyValue;
  }

  if (value >= 1000) {
    const seconds = value / 1000;
    const digits = seconds >= 10 ? 0 : 1;
    return `${new Intl.NumberFormat(intlLocale(locale), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(seconds)} s`;
  }

  return `${Math.round(value)} ms`;
}

function formatTime(value: string | null, locale: Locale, copy: Messages): string {
  if (!value) {
    return copy.emptyValue;
  }

  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatAvailability(value: number, locale: Locale): string {
  return `${new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function statusClass(level: ProbeStatusSample["level"]): string {
  switch (level) {
    case "up":
      return "is-up";
    case "degraded":
      return "is-degraded";
    case "down":
      return "is-down";
    case "empty":
      return "is-empty";
  }
}

type GroupedModels = {
  key: string;
  upstreamGroup: string;
  upstreamName: string;
  models: ModelSummary[];
};

function groupModels(models: ModelSummary[]): GroupedModels[] {
  const groups = new Map<string, GroupedModels>();

  for (const model of models) {
    const key = `${model.upstreamGroup}::${model.upstreamName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.models.push(model);
      continue;
    }

    groups.set(key, {
      key,
      upstreamGroup: model.upstreamGroup,
      upstreamName: model.upstreamName,
      models: [model],
    });
  }

  return [...groups.values()].map((group) => ({
    ...group,
    models: [...group.models].sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }

      return (left.displayName ?? left.model).localeCompare(right.displayName ?? right.model);
    }),
  }));
}

function toLocalizedMessage(error: unknown, locale: Locale, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) {
    return fallback;
  }

  return localizeRuntimeMessage(error.message, locale);
}

function AppHeader({ route, copy, actions }: { route: Route; copy: Messages; actions?: React.ReactNode }) {
  const showNav = route === "admin";

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark">
          <img className="brand-icon" src="/project-icon.svg" alt={copy.brandIconAlt} />
        </div>
        <div className="brand-copy">
          <h1 className="brand-title">{copy.brandTitle}</h1>
        </div>
      </div>

      <div className="header-actions">
        {showNav ? (
          <nav className="nav-list" aria-label={copy.brandTitle}>
            <a href="/" className="nav-link">
              {copy.navPublic}
            </a>
          </nav>
        ) : null}
        {actions}
      </div>
    </header>
  );
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="summary-tile">
      <p className="summary-label">{label}</p>
      <strong className="summary-value">{value}</strong>
      <p className="summary-detail">{detail}</p>
    </article>
  );
}

function availabilityTier(value: number): "low" | "medium" | "high" {
  if (value >= 70) {
    return "high";
  }

  if (value >= 50) {
    return "medium";
  }

  return "low";
}

function AvailabilityPill({
  value,
  locale,
  copy,
}: {
  value: number;
  locale: Locale;
  copy: Messages;
}) {
  const tier = availabilityTier(value);

  return (
    <span className={`availability-pill availability-pill-${tier}`}>
      <span className="availability-dot" aria-hidden="true" />
      <span>{copy.metricAvailability}</span>
      <strong>{formatAvailability(value, locale)}</strong>
    </span>
  );
}

function NoticeBanner({ tone, message }: { tone: NoticeTone; message: string }) {
  return (
    <div className={`notice notice-${tone}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}

function TurnstileWidget({ enabled, siteKey, resetNonce, onTokenChange }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(() => typeof window !== "undefined" && Boolean(window.turnstile));

  useEffect(() => {
    if (!enabled || !siteKey) {
      onTokenChange(null);
      return;
    }

    if (window.turnstile) {
      setScriptReady(true);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-script="true"]');
    if (existing) {
      existing.addEventListener("load", () => setScriptReady(true), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstileScript = "true";
    script.addEventListener("load", () => setScriptReady(true), { once: true });
    document.head.appendChild(script);
  }, [enabled, onTokenChange, siteKey]);

  useEffect(() => {
    if (!enabled || !siteKey || !scriptReady || !containerRef.current || !window.turnstile) {
      return;
    }

    containerRef.current.innerHTML = "";
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "light",
      callback: (token) => onTokenChange(token),
      "expired-callback": () => onTokenChange(null),
      "error-callback": () => onTokenChange(null),
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [enabled, onTokenChange, scriptReady, siteKey]);

  useEffect(() => {
    if (!widgetIdRef.current || !window.turnstile) {
      return;
    }

    onTokenChange(null);
    window.turnstile.reset(widgetIdRef.current);
  }, [onTokenChange, resetNonce]);

  if (!enabled || !siteKey) {
    return null;
  }

  return <div className="turnstile-shell" ref={containerRef} />;
}

function ProbeLogModal({
  state,
  copy,
  onClose,
}: {
  state: ProbeModalState;
  copy: Messages;
  onClose: () => void;
}) {
  if (!state.open) {
    return null;
  }

  const title = state.status === "running"
    ? copy.probeModalRunning
    : state.status === "finished"
      ? copy.probeModalFinished
      : copy.probeModalFailed;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="probe-log-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="section-kicker">{copy.probeModalTitle}</p>
            <h3 id="probe-log-modal-title" className="section-subtitle">{title}</h3>
          </div>
          <button className="button" type="button" onClick={onClose}>
            {copy.closeModal}
          </button>
        </div>

        <div className="log-console" role="log" aria-live="polite">
          {state.logs.map((entry) => (
            <div key={entry.id} className={`log-line log-line-${entry.tone}`}>
              {entry.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusTimeline({
  statuses,
  locale,
  copy,
}: {
  statuses: ProbeStatusSample[];
  locale: Locale;
  copy: Messages;
}) {
  return (
    <div className="timeline-shell" role="img" aria-label={copy.statusTimelineAria}>
      <div className="timeline">
        {statuses.map((status) => (
          <span
            key={status.id}
            className={`timeline-bar ${statusClass(status.level)}`}
            title={copy.statusTitle(
              localizedStatusLabel(status.level, locale),
              formatTime(status.startedAt, locale, copy),
              formatTime(status.endedAt, locale, copy),
              status.score === null ? copy.emptyValue : String(status.score),
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ModelPanel({
  model,
  locale,
  copy,
}: {
  model: ModelSummary;
  locale: Locale;
  copy: Messages;
}) {
  const isDenseTimeline = model.recentStatuses.length >= 30;

  return (
    <article className="model-panel">
      <div className={isDenseTimeline ? "model-inline model-inline-dense" : "model-inline"}>
        <div className="model-heading">
          <div className="model-name-row">
            <p className="model-name">
              {model.icon ? <span className="model-icon">{model.icon}</span> : null}
              <span>{model.displayName || model.model}</span>
            </p>
            <AvailabilityPill value={model.availabilityPercentage} locale={locale} copy={copy} />
          </div>
          <p className="model-subtitle">
            {model.model}
            {model.ownedBy ? ` / ${model.ownedBy}` : ""}
          </p>
        </div>

        <StatusTimeline statuses={model.recentStatuses} locale={locale} copy={copy} />

        <div className="metric-row">
          <div className="metric-cell">
            <span className="metric-label">{copy.metricFirstToken}</span>
            <strong className="metric-value">{formatLatency(model.avgFirstTokenLatencyMs, locale, copy)}</strong>
          </div>
          <div className="metric-cell">
            <span className="metric-label">{copy.metricTotal}</span>
            <strong className="metric-value">{formatLatency(model.avgTotalLatencyMs, locale, copy)}</strong>
          </div>
        </div>
      </div>
    </article>
  );
}

function PublicDashboard({
  locale,
  copy,
  range,
}: {
  locale: Locale;
  copy: Messages;
  range: DashboardRange;
}) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadDashboard(nextRange: DashboardRange) {
      try {
        const data = await fetchDashboard(nextRange);
        if (!isActive) {
          return;
        }

        startTransition(() => {
          setDashboard(data);
          setError(null);
        });
      } catch (requestError) {
        if (!isActive) {
          return;
        }

        setError(toLocalizedMessage(requestError, locale, copy.errorLoadDashboard));
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    }

    void loadDashboard(range);
    const intervalId = window.setInterval(() => {
      void loadDashboard(range);
    }, 60_000);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [copy.errorLoadDashboard, locale, range]);

  const groups = useMemo(() => groupModels(dashboard?.models ?? []), [dashboard?.models]);

  return (
    <>
      <dl className="meta-strip public-meta-strip">
        <div className="meta-item">
          <dt className="meta-label">{copy.lastProbe}</dt>
          <dd className="meta-value">{formatTime(dashboard?.meta.lastProbeAt ?? null, locale, copy)}</dd>
        </div>
        <div className="meta-item">
          <dt className="meta-label">{copy.nextProbe}</dt>
          <dd className="meta-value">{formatTime(dashboard?.meta.nextProbeAt ?? null, locale, copy)}</dd>
        </div>
        <div className="meta-item">
          <dt className="meta-label">{copy.lastCatalogSync}</dt>
          <dd className="meta-value">{formatTime(dashboard?.meta.lastCatalogSyncAt ?? null, locale, copy)}</dd>
        </div>
      </dl>

      {dashboard?.meta.isProbeCycleRunning ? <p className="section-note public-note">{copy.rangeHintRunning}</p> : null}

      <section className="page-stack">
        {loading ? <div className="panel empty-state">{copy.loadingDashboard}</div> : null}
        {error ? <NoticeBanner tone="error" message={error} /> : null}

        {!loading && !error ? (
          <div className="page-stack">
            {groups.length === 0 ? <div className="panel empty-state">{copy.publicEmpty}</div> : null}

            {groups.map((group) => (
              <section key={group.key} className="panel group-section">
                <div className="section-heading">
                  <div className="section-heading-main">
                    <p className="section-kicker">{group.upstreamGroup}</p>
                    <h3 className="section-subtitle">{group.upstreamName}</h3>
                  </div>
                  <p className="section-count">{copy.groupCount(group.models.length)}</p>
                </div>

                <div className="model-list">
                  {group.models.map((model) => (
                    <ModelPanel key={`${model.upstreamId}:${model.model}`} model={model} locale={locale} copy={copy} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        <footer className="public-footer">
          <span>{copy.publicFooterPoweredBy} </span>
          <a
            className="public-footer-link"
            href="https://github.com/essesoul/model-status-worker"
            target="_blank"
            rel="noreferrer"
          >
            model-status-worker
          </a>
        </footer>
      </section>
    </>
  );
}

function formatProbeLogMessage(event: ProbeStreamEvent, copy: Messages, locale: Locale): ProbeLogEntry {
  if (event.type === "cycle-started") {
    return {
      id: `${event.type}-${event.startedAt}`,
      tone: "info",
      message: copy.probeLogCycleStarted(event.total),
    };
  }

  if (event.type === "attempt-started") {
    return {
      id: `${event.type}-${event.upstreamId}-${event.model}-${event.attempt}-${event.startedAt}`,
      tone: "info",
      message: copy.probeLogAttemptStarted(event.upstreamName, event.model, event.attempt),
    };
  }

  if (event.type === "attempt-finished") {
    if (!event.result.success) {
      return {
        id: `${event.type}-${event.upstreamId}-${event.model}-${event.attempt}-${event.finishedAt}`,
        tone: "error",
        message: copy.probeLogAttemptFailure(
          event.upstreamName,
          event.model,
          event.attempt,
          localizeRuntimeMessage(event.result.error ?? copy.errorAction, locale),
        ),
      };
    }

    return {
      id: `${event.type}-${event.upstreamId}-${event.model}-${event.attempt}-${event.finishedAt}`,
      tone: event.classification === "up" ? "success" : "info",
        message: copy.probeLogAttemptSuccess(
          event.upstreamName,
          event.model,
          localizedStatusLabel(event.classification, locale),
          event.score,
          formatLatency(event.result.totalLatencyMs, locale, copy),
          formatLatency(event.result.firstTokenLatencyMs, locale, copy),
        ),
      };
  }

  return {
    id: `${event.type}-${event.finishedAt}`,
    tone: event.failed > 0 ? "error" : "success",
    message: copy.probeLogCycleFinished(event.total, event.succeeded, event.failed),
  };
}

function AdminConsole({ locale, copy }: { locale: Locale; copy: Messages }) {
  const [session, setSession] = useState<AdminSessionResponse>({
    authenticated: false,
    username: null,
    turnstile: {
      enabled: false,
      siteKey: "",
    },
  });
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetNonce, setTurnstileResetNonce] = useState(0);
  const [turnstileSecretKey, setTurnstileSecretKey] = useState("");
  const [settings, setSettings] = useState<AdminSettingsResponse | null>(null);
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [upstreams, setUpstreams] = useState<EditableUpstream[]>([]);
  const [models, setModels] = useState<EditableModel[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const [probeModal, setProbeModal] = useState<ProbeModalState>({
    open: false,
    status: "running",
    logs: [],
  });
  const probeStreamAbortRef = useRef<AbortController | null>(null);

  function handleCloseProbeModal() {
    probeStreamAbortRef.current?.abort();
    probeStreamAbortRef.current = null;
    setProbeModal((current) => ({ ...current, open: false }));
  }

  useEffect(() => {
    let isActive = true;

    async function loadSession() {
      try {
        const nextSession = await fetchAdminSession();
        if (!isActive) {
          return;
        }

        setSession(nextSession);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setNotice({
          tone: "error",
          message: toLocalizedMessage(error, locale, copy.errorReadSession),
        });
      }
    }

    void loadSession();

    return () => {
      isActive = false;
    };
  }, [copy.errorReadSession, locale]);

  useEffect(() => {
    if (!session.authenticated) {
      return;
    }

    let isActive = true;

    async function loadAdminData() {
      try {
        const [nextSettings, nextDashboard] = await Promise.all([
          fetchAdminSettings(),
          fetchAdminDashboard("24h"),
        ]);

        if (!isActive) {
          return;
        }

        startTransition(() => {
          setSettings(nextSettings);
          setDashboard(nextDashboard);
          setUpstreams(nextSettings.upstreams.map((upstream) => ({ ...upstream, newApiKey: "" })));
          setModels(nextDashboard.models.map((model) => ({ ...model })));
          setTurnstileSecretKey("");
        });
      } catch (error) {
        if (!isActive) {
          return;
        }

        setNotice({
          tone: "error",
          message: toLocalizedMessage(error, locale, copy.errorLoadAdminData),
        });
      }
    }

    void loadAdminData();

    return () => {
      isActive = false;
    };
  }, [copy.errorLoadAdminData, locale, session.authenticated]);

  async function refreshAdminData() {
    try {
      const [nextSettings, nextDashboard] = await Promise.all([
        fetchAdminSettings(),
        fetchAdminDashboard("24h"),
      ]);

      startTransition(() => {
        setSettings(nextSettings);
        setDashboard(nextDashboard);
        setUpstreams(nextSettings.upstreams.map((upstream) => ({ ...upstream, newApiKey: "" })));
        setModels(nextDashboard.models.map((model) => ({ ...model })));
        setTurnstileSecretKey("");
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: toLocalizedMessage(error, locale, copy.errorLoadAdminData),
      });
    }
  }

  function updateSetting<K extends keyof NonNullable<typeof settings>["settings"]>(
    key: K,
    value: NonNullable<typeof settings>["settings"][K],
  ) {
    setSettings((current) =>
      current
        ? {
            ...current,
            settings: {
              ...current.settings,
              [key]: value,
            },
          }
        : current,
    );
  }

  function patchUpstream(index: number, patch: Partial<EditableUpstream>) {
    setUpstreams((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function patchModel(index: number, patch: Partial<EditableModel>) {
    setModels((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function updateTurnstileConfig(patch: Partial<NonNullable<typeof settings>["turnstile"]>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            turnstile: {
              ...current.turnstile,
              ...patch,
            },
          }
        : current,
    );
  }

  function handleRemoveUpstream(index: number) {
    setUpstreams((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setNotice({ tone: "success", message: copy.noticeUpstreamRemoved });
  }

  function handleRemoveModel(index: number) {
    setModels((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setNotice({ tone: "success", message: copy.noticeModelRemoved });
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("login");

    try {
      const payload: LoginPayload = { username, password, turnstileToken };
      const nextSession = await loginAdmin(payload);
      setSession(nextSession);
      setPassword("");
      setTurnstileToken(null);
      setNotice({ tone: "success", message: copy.noticeSignedIn });
    } catch (error) {
      setTurnstileToken(null);
      setTurnstileResetNonce((current) => current + 1);
      setNotice({
        tone: "error",
        message: toLocalizedMessage(error, locale, copy.errorLogin),
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleLogout() {
    setBusy("logout");

    try {
      const nextSession = await logoutAdmin();
      setSession(nextSession);
      setSettings(null);
      setDashboard(null);
      setUpstreams([]);
      setModels([]);
      setTurnstileToken(null);
      setNotice({ tone: "success", message: copy.noticeLoggedOut });
    } catch (error) {
      setNotice({
        tone: "error",
        message: toLocalizedMessage(error, locale, copy.errorAction),
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveSettings() {
    if (!settings) {
      return;
    }

    setBusy("settings");

    try {
      const payload = {
        ...settings.settings,
        upstreams: upstreams.map<UpstreamPayload>((upstream) => ({
          id: upstream.id,
          name: upstream.name,
          group: upstream.group,
          apiBaseUrl: upstream.apiBaseUrl,
          modelsUrl: upstream.modelsUrl,
          isActive: upstream.isActive,
          apiKey: upstream.newApiKey.trim() || undefined,
        })),
        turnstile: {
          enabled: settings.turnstile.enabled,
          siteKey: settings.turnstile.siteKey,
          secretKey: turnstileSecretKey.trim() || undefined,
        },
      };

      const nextSettings = await saveAdminSettings(payload);
      setSettings(nextSettings);
      setUpstreams(nextSettings.upstreams.map((upstream) => ({ ...upstream, newApiKey: "" })));
      setTurnstileSecretKey("");
      setSession((current) => ({
        ...current,
        turnstile: {
          enabled: nextSettings.turnstile.enabled && nextSettings.turnstile.secretKeyConfigured && nextSettings.turnstile.siteKey.trim().length > 0,
          siteKey: nextSettings.turnstile.siteKey,
        },
      }));
      setNotice({ tone: "success", message: copy.noticeSettingsSaved });
      await refreshAdminData();
    } catch (error) {
      setNotice({
        tone: "error",
        message: toLocalizedMessage(error, locale, copy.errorSaveSettings),
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveModels() {
    setBusy("models");

    try {
      const payload: AdminModelsPayload = {
        models: models.map((model) => ({
          upstreamId: model.upstreamId,
          id: model.model,
          displayName: model.displayName,
          icon: model.icon,
          isVisible: model.isVisible,
          sortOrder: model.sortOrder,
        })),
      };

      await saveAdminModels(payload);
      setNotice({ tone: "success", message: copy.noticeModelsSaved });
      await refreshAdminData();
    } catch (error) {
      setNotice({
        tone: "error",
        message: toLocalizedMessage(error, locale, copy.errorSaveModels),
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleAction(action: "sync" | "probe") {
    if (action === "probe") {
      await handleProbeWithLogs();
      return;
    }

    setBusy(action);

    try {
      const result: AdminActionResponse = await syncCatalogNow();
      setNotice({ tone: "success", message: localizeRuntimeMessage(result.message, locale) });
      await refreshAdminData();
    } catch (error) {
      setNotice({
        tone: "error",
        message: toLocalizedMessage(error, locale, copy.errorAction),
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleProbeWithLogs() {
    setBusy("probe");
    setProbeModal({
      open: true,
      status: "running",
      logs: [],
    });

    probeStreamAbortRef.current?.abort();
    const controller = new AbortController();
    probeStreamAbortRef.current = controller;
    let fatalMessage: string | null = null;

    try {
      await streamProbeLogs((message: ProbeStreamMessage) => {
        if (message.event === "probe-event") {
          const nextLog = formatProbeLogMessage(message.data, copy, locale);
          setProbeModal((current) => ({
            ...current,
            logs: [...current.logs, nextLog],
          }));
          return;
        }

        if (message.event === "done") {
          setProbeModal((current) => ({
            ...current,
            status: "finished",
          }));
          return;
        }

        if (message.event === "fatal") {
          const localizedFatalMessage = localizeRuntimeMessage(message.data.message, locale);
          fatalMessage = localizedFatalMessage;
          setProbeModal((current) => ({
            ...current,
            status: "failed",
            logs: [
              ...current.logs,
              {
                id: `fatal-${Date.now()}`,
                tone: "error",
                message: copy.probeLogStreamFailed(localizedFatalMessage),
              },
            ],
          }));
        }
      }, controller.signal);

      if (fatalMessage) {
        setNotice({
          tone: "error",
          message: copy.probeLogStreamFailed(fatalMessage),
        });
      } else {
        setNotice({ tone: "success", message: copy.noticeProbeRefresh });
        await refreshAdminData();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setProbeModal((current) => ({
        ...current,
        status: "failed",
        logs: [
          ...current.logs,
          {
            id: `stream-error-${Date.now()}`,
            tone: "error",
            message: copy.probeLogStreamFailed(toLocalizedMessage(error, locale, copy.errorAction)),
          },
        ],
      }));
      setNotice({
        tone: "error",
        message: toLocalizedMessage(error, locale, copy.errorAction),
      });
    } finally {
      if (probeStreamAbortRef.current === controller) {
        probeStreamAbortRef.current = null;
      }
      setBusy(null);
    }
  }

  if (!session.authenticated) {
    const turnstileEnabled = session.turnstile.enabled && session.turnstile.siteKey.trim().length > 0;

    return (
      <section className="page-stack">
        <section className="panel auth-panel">
          <div className="auth-copy">
            <p className="section-kicker">{copy.adminSignInKicker}</p>
            <h2 className="auth-title">{copy.adminSignInTitle}</h2>
            <p className="section-description">{copy.adminSignInBody}</p>
          </div>

          <form className="auth-form" onSubmit={handleLogin}>
            <label className="field">
              <span className="field-label">{copy.username}</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="field">
              <span className="field-label">{copy.password}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <TurnstileWidget
              enabled={turnstileEnabled}
              siteKey={session.turnstile.siteKey}
              resetNonce={turnstileResetNonce}
              onTokenChange={setTurnstileToken}
            />
            <button className="button button-primary auth-submit" type="submit" disabled={busy === "login" || (turnstileEnabled && !turnstileToken)}>
              {busy === "login" ? copy.signingIn : copy.signIn}
            </button>
          </form>
        </section>

        {notice ? <NoticeBanner tone={notice.tone} message={notice.message} /> : null}
      </section>
    );
  }

  const headerTitle = settings ? resolveSystemTitle(settings.settings.siteTitle, locale) : copy.adminLoadingTitle;

  return (
    <section className="page-stack">
      <ProbeLogModal
        state={probeModal}
        copy={copy}
        onClose={handleCloseProbeModal}
      />

      <section className="panel intro-panel">
        <div className="section-intro">
          <div className="section-copy">
            <p className="section-kicker">{copy.adminKicker}</p>
            <h2 className="section-title">{headerTitle}</h2>
            <p className="section-description">{copy.adminBody}</p>
          </div>
        </div>

        <div className="action-row">
          <button className="button" type="button" disabled={busy === "sync"} onClick={() => void handleAction("sync")}>
            {busy === "sync" ? copy.actionSyncing : copy.actionSync}
          </button>
          <button className="button" type="button" disabled={busy === "probe"} onClick={() => void handleAction("probe")}>
            {busy === "probe" ? copy.actionProbing : copy.actionProbe}
          </button>
          <button className="button button-primary" type="button" disabled={busy === "settings" || !settings} onClick={() => void handleSaveSettings()}>
            {busy === "settings" ? copy.actionSaving : copy.actionSaveSettings}
          </button>
          <button className="button button-primary" type="button" disabled={busy === "models" || dashboard === null} onClick={() => void handleSaveModels()}>
            {busy === "models" ? copy.actionSaving : copy.actionSaveModels}
          </button>
          <button className="button" type="button" disabled={busy === "logout"} onClick={() => void handleLogout()}>
            {busy === "logout" ? copy.actionLeaving : copy.actionLogout}
          </button>
        </div>
      </section>

      {notice ? <NoticeBanner tone={notice.tone} message={notice.message} /> : null}

      {dashboard ? (
        <section className="summary-grid">
          <MetricTile
            label={copy.summaryVisible}
            value={String(dashboard.summary.totalModels)}
            detail={copy.summaryVisibleDetail(dashboard.summary.hiddenModels)}
          />
          <MetricTile
            label={copy.summaryHealthyShort}
            value={String(dashboard.summary.availableModels)}
            detail={copy.summaryHealthyShortDetail(dashboard.summary.degradedModels, dashboard.summary.errorModels)}
          />
          <MetricTile
            label={copy.summaryLastCatalogSync}
            value={formatTime(dashboard.meta.lastCatalogSyncAt, locale, copy)}
            detail={copy.summaryLastCatalogSyncDetail(formatTime(dashboard.meta.lastProbeAt, locale, copy))}
          />
          <MetricTile
            label={copy.summaryAverageLatency}
            value={formatLatency(dashboard.summary.avgTotalLatencyMs, locale, copy)}
            detail={copy.summaryAverageLatencyDetail(formatAvailability(dashboard.summary.availabilityPercentage, locale))}
          />
        </section>
      ) : null}

      <div className="admin-grid">
        <section className="panel section-panel">
          <div className="section-heading">
            <div className="section-heading-main">
              <p className="section-kicker">{copy.runtimeKicker}</p>
              <h3 className="section-subtitle">{copy.runtimeTitle}</h3>
            </div>
          </div>
          <p className="section-description">{copy.runtimeBody}</p>

          {settings ? (
            <div className="form-grid">
              <label className="field field-span-2">
                <span className="field-label">{copy.fieldSiteTitle}</span>
                <input value={settings.settings.siteTitle} onChange={(event) => updateSetting("siteTitle", event.target.value)} />
              </label>
              <label className="field field-span-2">
                <span className="field-label">{copy.fieldSiteSubtitle}</span>
                <input value={settings.settings.siteSubtitle} onChange={(event) => updateSetting("siteSubtitle", event.target.value)} />
              </label>
              <label className="checkbox-field field-span-2">
                <input
                  type="checkbox"
                  checked={settings.settings.showSummaryCards}
                  onChange={(event) => updateSetting("showSummaryCards", event.target.checked)}
                />
                <span className="field-label">{copy.fieldShowSummaryCards}</span>
              </label>
              <label className="field">
                <span className="field-label">{copy.fieldProbeInterval}</span>
                <input type="number" value={settings.settings.probeIntervalMs} onChange={(event) => updateSetting("probeIntervalMs", Number(event.target.value))} />
              </label>
              <label className="field">
                <span className="field-label">{copy.fieldCatalogSyncInterval}</span>
                <input
                  type="number"
                  value={settings.settings.catalogSyncIntervalMs}
                  onChange={(event) => updateSetting("catalogSyncIntervalMs", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label">{copy.fieldProbeTimeout}</span>
                <input type="number" value={settings.settings.probeTimeoutMs} onChange={(event) => updateSetting("probeTimeoutMs", Number(event.target.value))} />
              </label>
              <label className="field">
                <span className="field-label">{copy.fieldProbeConcurrency}</span>
                <input type="number" value={settings.settings.probeConcurrency} onChange={(event) => updateSetting("probeConcurrency", Number(event.target.value))} />
              </label>
              <label className="field">
                <span className="field-label">{copy.fieldProbeMaxTokens}</span>
                <input type="number" value={settings.settings.probeMaxTokens} onChange={(event) => updateSetting("probeMaxTokens", Number(event.target.value))} />
              </label>
              <label className="field">
                <span className="field-label">{copy.fieldProbeTemperature}</span>
                <input
                  type="number"
                  step="0.1"
                  value={settings.settings.probeTemperature}
                  onChange={(event) => updateSetting("probeTemperature", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label">{copy.fieldHealthyThreshold}</span>
                <input
                  type="number"
                  value={settings.settings.modelStatusUpScoreThreshold}
                  onChange={(event) => updateSetting("modelStatusUpScoreThreshold", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label">{copy.fieldDegradedThreshold}</span>
                <input
                  type="number"
                  value={settings.settings.modelStatusDegradedScoreThreshold}
                  onChange={(event) => updateSetting("modelStatusDegradedScoreThreshold", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label">{copy.fieldDegradedRetries}</span>
                <input
                  type="number"
                  value={settings.settings.degradedRetryAttempts}
                  onChange={(event) => updateSetting("degradedRetryAttempts", Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-label">{copy.fieldFailedRetries}</span>
                <input
                  type="number"
                  value={settings.settings.failedRetryAttempts}
                  onChange={(event) => updateSetting("failedRetryAttempts", Number(event.target.value))}
                />
              </label>
              <div className="form-divider field-span-2" aria-hidden="true" />
              <label className="checkbox-field field-span-2">
                <input
                  type="checkbox"
                  checked={settings.turnstile.enabled}
                  onChange={(event) => updateTurnstileConfig({ enabled: event.target.checked })}
                />
                <span className="field-label">{copy.fieldTurnstileEnabled}</span>
              </label>
              <label className="field field-span-2">
                <span className="field-label">{copy.fieldTurnstileSiteKey}</span>
                <input
                  value={settings.turnstile.siteKey}
                  onChange={(event) => updateTurnstileConfig({ siteKey: event.target.value })}
                />
              </label>
              <label className="field field-span-2">
                <span className="field-label">{copy.fieldTurnstileSecretKey}</span>
                <input
                  type="password"
                  placeholder={copy.turnstileSecretPlaceholder}
                  value={turnstileSecretKey}
                  onChange={(event) => setTurnstileSecretKey(event.target.value)}
                />
                <span className="field-help">
                  {copy.fieldStoredSecret}: {settings.turnstile.secretKeyMasked ?? copy.storedSecretMissing}
                </span>
              </label>
            </div>
          ) : (
            <div className="empty-state">{copy.loadingAdminSettings}</div>
          )}
        </section>

        <section className="panel section-panel">
          <div className="section-heading">
            <div className="section-heading-main">
              <p className="section-kicker">{copy.upstreamKicker}</p>
              <h3 className="section-subtitle">{copy.upstreamTitle}</h3>
            </div>
          </div>
          <p className="section-description">{copy.upstreamBody}</p>

          <div className="stack-list">
            {upstreams.map((upstream, index) => (
              <div key={upstream.id || `new-${index}`} className="subsection-block">
                <div className="subsection-header">
                  <strong className="subsection-title">{upstream.name || copy.draftUpstreamName}</strong>
                  <div className="subsection-tools">
                    <span className={`state-chip ${upstream.isActive ? "is-up" : "is-empty"}`}>
                      {upstream.isActive ? copy.fieldActive : copy.inactiveStatus}
                    </span>
                    <button className="button button-danger" type="button" onClick={() => handleRemoveUpstream(index)}>
                      {copy.deleteUpstream}
                    </button>
                  </div>
                </div>

                <div className="form-grid">
                  <label className="field">
                    <span className="field-label">{copy.fieldName}</span>
                    <input value={upstream.name} onChange={(event) => patchUpstream(index, { name: event.target.value })} />
                  </label>
                  <label className="field">
                    <span className="field-label">{copy.fieldGroup}</span>
                    <input value={upstream.group} onChange={(event) => patchUpstream(index, { group: event.target.value })} />
                  </label>
                  <label className="field field-span-2">
                    <span className="field-label">{copy.fieldApiBaseUrl}</span>
                    <input value={upstream.apiBaseUrl} onChange={(event) => patchUpstream(index, { apiBaseUrl: event.target.value })} />
                  </label>
                  <label className="field field-span-2">
                    <span className="field-label">{copy.fieldModelsUrl}</span>
                    <input value={upstream.modelsUrl} onChange={(event) => patchUpstream(index, { modelsUrl: event.target.value })} />
                  </label>
                  <label className="field field-span-2">
                    <span className="field-label">{copy.fieldNewApiKey}</span>
                    <input
                      type="password"
                      placeholder={copy.apiKeyPlaceholder}
                      value={upstream.newApiKey}
                      onChange={(event) => patchUpstream(index, { newApiKey: event.target.value })}
                    />
                    <span className="field-help">
                      {copy.fieldStoredApiKey}: {upstream.apiKeyMasked ?? copy.storedApiKeyMissing}
                    </span>
                  </label>
                  <label className="checkbox-field field-span-2">
                    <input type="checkbox" checked={upstream.isActive} onChange={(event) => patchUpstream(index, { isActive: event.target.checked })} />
                    <span className="field-label">{copy.fieldActive}</span>
                  </label>
                </div>
              </div>
            ))}
          </div>

          <button
            className="button"
            type="button"
            onClick={() =>
              setUpstreams((current) => [
                ...current,
                {
                  id: `draft-${crypto.randomUUID().slice(0, 8)}`,
                  name: copy.draftUpstreamName,
                  group: "default",
                  apiBaseUrl: "https://api.openai.com/v1",
                  modelsUrl: "https://api.openai.com/v1/models",
                  isActive: true,
                  apiKeyConfigured: false,
                  apiKeyMasked: null,
                  newApiKey: "",
                },
              ])
            }
          >
            {copy.addUpstream}
          </button>
        </section>
      </div>

      <section className="panel section-panel">
        <div className="section-heading">
          <div className="section-heading-main">
            <p className="section-kicker">{copy.modelsKicker}</p>
            <h3 className="section-subtitle">{copy.modelsTitle}</h3>
          </div>
        </div>
        <p className="section-description">{copy.modelsBody}</p>

        {models.length === 0 ? (
          <div className="empty-state">{copy.emptyModelsAdmin}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{copy.tableModel}</th>
                  <th>{copy.tableDisplayName}</th>
                  <th>{copy.tableIcon}</th>
                  <th>{copy.tableVisible}</th>
                  <th>{copy.tableSort}</th>
                  <th>{copy.tableStatus}</th>
                  <th>{copy.tableActions}</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model, index) => (
                  <tr key={`${model.upstreamId}:${model.model}`}>
                    <td>
                      <strong>{model.model}</strong>
                      <div className="table-muted">{model.upstreamName}</div>
                    </td>
                    <td>
                      <input value={model.displayName ?? ""} onChange={(event) => patchModel(index, { displayName: event.target.value || null })} />
                    </td>
                    <td>
                      <input value={model.icon ?? ""} onChange={(event) => patchModel(index, { icon: event.target.value || null })} />
                    </td>
                    <td className="table-check">
                      <input type="checkbox" checked={model.isVisible} onChange={(event) => patchModel(index, { isVisible: event.target.checked })} />
                    </td>
                    <td>
                      <input type="number" value={model.sortOrder} onChange={(event) => patchModel(index, { sortOrder: Number(event.target.value) })} />
                    </td>
                    <td>
                      <span className={`state-chip ${statusClass(model.latestStatus)}`}>
                        {localizedStatusLabel(model.latestStatus, locale)}
                      </span>
                    </td>
                    <td className="table-actions">
                      <button className="button button-danger" type="button" onClick={() => handleRemoveModel(index)}>
                        {copy.deleteModel}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

export default function App() {
  const route = getRoute();
  const [locale, setLocale] = useState<Locale>(() => detectBrowserLocale());
  const [publicTimelineUnit, setPublicTimelineUnit] = useState<PublicTimelineUnit>("hours");
  const copy = getMessages(locale);
  const publicRange: DashboardRange = publicTimelineUnit === "hours" ? "30h" : "30d";

  useEffect(() => {
    function handleLanguageChange() {
      setLocale(detectBrowserLocale());
    }

    window.addEventListener("languagechange", handleLanguageChange);

    return () => {
      window.removeEventListener("languagechange", handleLanguageChange);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = route === "admin" ? copy.documentTitleAdmin : copy.documentTitlePublic;
  }, [copy.documentTitleAdmin, copy.documentTitlePublic, locale, route]);

  return (
    <div className="shell">
      <main className="layout">
        <AppHeader
          route={route}
          copy={copy}
          actions={route === "public" ? (
            <div className="range-list" role="tablist" aria-label={copy.publicKicker}>
              <button
                type="button"
                className={publicTimelineUnit === "hours" ? "range-button range-button-active" : "range-button"}
                onClick={() => setPublicTimelineUnit("hours")}
                aria-pressed={publicTimelineUnit === "hours"}
              >
                {copy.timelineUnitHours}
              </button>
              <button
                type="button"
                className={publicTimelineUnit === "days" ? "range-button range-button-active" : "range-button"}
                onClick={() => setPublicTimelineUnit("days")}
                aria-pressed={publicTimelineUnit === "days"}
              >
                {copy.timelineUnitDays}
              </button>
            </div>
          ) : null}
        />
        {route === "admin"
          ? <AdminConsole locale={locale} copy={copy} />
          : <PublicDashboard locale={locale} copy={copy} range={publicRange} />}
      </main>
    </div>
  );
}
