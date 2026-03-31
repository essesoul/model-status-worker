import type {
  AdminActionResponse,
  AdminDashboardResponse,
  AdminSessionResponse,
  AdminSettingsResponse,
  DashboardRange,
  DashboardResponse,
  ModelSummary,
  ProbeStatusSample,
  UpstreamView,
} from "@model-status/shared";
import { DASHBOARD_RANGES } from "@model-status/shared";
import { startTransition, useEffect, useEffectEvent, useMemo, useState } from "react";

import {
  fetchAdminDashboard,
  fetchAdminSession,
  fetchAdminSettings,
  fetchDashboard,
  loginAdmin,
  logoutAdmin,
  probeNow,
  saveAdminModels,
  saveAdminSettings,
  syncCatalogNow,
  type AdminModelsPayload,
  type LoginPayload,
  type UpstreamPayload,
} from "./api";

type Route = "public" | "admin";
type NoticeTone = "success" | "error";

type EditableUpstream = UpstreamView & {
  newApiKey: string;
};

type EditableModel = AdminDashboardResponse["models"][number];

function getRoute(): Route {
  return window.location.pathname.startsWith("/admin") ? "admin" : "public";
}

function formatLatency(value: number | null): string {
  return value === null ? "--" : `${Math.round(value)} ms`;
}

function formatTime(value: string | null): string {
  if (!value) {
    return "--";
  }

  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAvailability(value: number): string {
  return `${value.toFixed(1)}%`;
}

function statusLabel(level: ProbeStatusSample["level"]): string {
  switch (level) {
    case "up":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "down":
      return "Down";
    case "empty":
      return "No Data";
  }
}

function statusClass(level: ProbeStatusSample["level"]): string {
  switch (level) {
    case "up":
      return "status-up";
    case "degraded":
      return "status-degraded";
    case "down":
      return "status-down";
    case "empty":
      return "status-empty";
  }
}

function groupModels(models: ModelSummary[]): Array<[string, ModelSummary[]]> {
  const groups = new Map<string, ModelSummary[]>();

  for (const model of models) {
    const key = `${model.upstreamGroup} / ${model.upstreamName}`;
    const existing = groups.get(key) ?? [];
    existing.push(model);
    groups.set(key, existing);
  }

  return [...groups.entries()];
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="mesh" />
      {children}
    </div>
  );
}

function Topbar({ route }: { route: Route }) {
  return (
    <header className="topbar panel">
      <div className="brand-block">
        <img className="brand-icon" src="/project-icon.svg" alt="Model Status icon" />
        <div className="brand-copy">
          <p className="eyebrow">Cloudflare Pages + Worker + D1</p>
          <h1 className="headline">Model Status Edge</h1>
          <p className="subheadline">
            Inspired by WizisCool/model-status, rebuilt for one-command Cloudflare deployment.
          </p>
        </div>
      </div>
      <nav className="topbar-links">
        <a href="/" className={route === "public" ? "nav-link nav-link-active" : "nav-link"}>
          Public
        </a>
        <a href="/admin" className={route === "admin" ? "nav-link nav-link-active" : "nav-link"}>
          Admin
        </a>
      </nav>
    </header>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="summary-card panel">
      <p className="card-label">{label}</p>
      <strong className="card-value">{value}</strong>
      <p className="card-detail">{detail}</p>
    </article>
  );
}

function StatusBars({ statuses }: { statuses: ProbeStatusSample[] }) {
  return (
    <div className="status-bars" role="img" aria-label="Recent model status">
      {statuses.map((status) => (
        <span
          key={status.id}
          className={`status-bar ${statusClass(status.level)}`}
          title={`${statusLabel(status.level)} | ${formatTime(status.startedAt)} - ${formatTime(status.endedAt)} | ${status.score ?? "--"}`}
        />
      ))}
    </div>
  );
}

function ModelRow({ model }: { model: ModelSummary }) {
  return (
    <article className="model-row panel">
      <div className="model-title-row">
        <div>
          <p className="model-name">
            {model.icon ? <span className="model-icon">{model.icon}</span> : null}
            <span>{model.displayName || model.model}</span>
          </p>
          <p className="model-meta">
            {model.model}
            {model.ownedBy ? ` / ${model.ownedBy}` : ""}
          </p>
        </div>
        <span className={`status-pill ${statusClass(model.latestStatus)}`}>{statusLabel(model.latestStatus)}</span>
      </div>

      <StatusBars statuses={model.recentStatuses} />

      <div className="metric-grid">
        <div>
          <span className="metric-label">Availability</span>
          <strong>{formatAvailability(model.availabilityPercentage)}</strong>
        </div>
        <div>
          <span className="metric-label">Connect</span>
          <strong>{formatLatency(model.avgConnectivityLatencyMs)}</strong>
        </div>
        <div>
          <span className="metric-label">First token</span>
          <strong>{formatLatency(model.avgFirstTokenLatencyMs)}</strong>
        </div>
        <div>
          <span className="metric-label">Total</span>
          <strong>{formatLatency(model.avgTotalLatencyMs)}</strong>
        </div>
      </div>
    </article>
  );
}

function PublicDashboard() {
  const [range, setRange] = useState<DashboardRange>("24h");
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDashboard = useEffectEvent(async (nextRange: DashboardRange) => {
    try {
      const data = await fetchDashboard(nextRange);
      startTransition(() => {
        setDashboard(data);
        setError(null);
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void refreshDashboard(range);
    const interval = window.setInterval(() => {
      void refreshDashboard(range);
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [range, refreshDashboard]);

  const groups = useMemo(() => groupModels(dashboard?.models ?? []), [dashboard?.models]);

  return (
    <section className="stack">
      <div className="hero panel">
        <div className="hero-copy">
          <p className="eyebrow">Public Status Board</p>
          <h2>{dashboard?.meta.siteTitle ?? "Loading dashboard"}</h2>
          <p>{dashboard?.meta.siteSubtitle ?? "Polling D1-backed probe history from the Worker API."}</p>
        </div>
        <div className="hero-meta">
          <div>
            <span className="hero-label">Last probe</span>
            <strong>{formatTime(dashboard?.meta.lastProbeAt ?? null)}</strong>
          </div>
          <div>
            <span className="hero-label">Next probe</span>
            <strong>{formatTime(dashboard?.meta.nextProbeAt ?? null)}</strong>
          </div>
        </div>
      </div>

      <div className="range-strip panel">
        <div className="range-buttons">
          {DASHBOARD_RANGES.map((option) => (
            <button
              key={option}
              type="button"
              className={option === range ? "chip chip-active" : "chip"}
              onClick={() => setRange(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <p className="range-hint">
          {dashboard?.meta.isProbeCycleRunning ? "Probe cycle is currently running." : "Dashboard refreshes automatically every minute."}
        </p>
      </div>

      {dashboard?.meta.showSummaryCards ? (
        <div className="summary-grid">
          <SummaryCard
            label="Healthy models"
            value={String(dashboard?.summary.availableModels ?? 0)}
            detail={`of ${dashboard?.summary.totalModels ?? 0} visible models`}
          />
          <SummaryCard
            label="Degraded models"
            value={String(dashboard?.summary.degradedModels ?? 0)}
            detail={`Down: ${dashboard?.summary.errorModels ?? 0}`}
          />
          <SummaryCard
            label="Average availability"
            value={formatAvailability(dashboard?.summary.availabilityPercentage ?? 0)}
            detail={`Connect ${formatLatency(dashboard?.summary.avgConnectivityLatencyMs ?? null)}`}
          />
          <SummaryCard
            label="Average total latency"
            value={formatLatency(dashboard?.summary.avgTotalLatencyMs ?? null)}
            detail={`First token ${formatLatency(dashboard?.summary.avgFirstTokenLatencyMs ?? null)}`}
          />
        </div>
      ) : null}

      {loading ? <div className="panel empty-state">Loading dashboard...</div> : null}
      {error ? <div className="panel empty-state error-state">{error}</div> : null}

      {!loading && !error ? (
        <div className="stack">
          {groups.length === 0 ? (
            <div className="panel empty-state">
              No visible models yet. Add an upstream API key in the admin panel, then sync the catalog and run a probe.
            </div>
          ) : null}

          {groups.map(([groupName, models]) => (
            <section key={groupName} className="group-block">
              <div className="group-heading">
                <p className="eyebrow">Upstream Group</p>
                <h3>{groupName}</h3>
              </div>
              <div className="stack">
                {models.map((model) => (
                  <ModelRow key={`${model.upstreamId}:${model.model}`} model={model} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AdminConsole() {
  const [session, setSession] = useState<AdminSessionResponse>({ authenticated: false, username: null });
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [settings, setSettings] = useState<AdminSettingsResponse | null>(null);
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [upstreams, setUpstreams] = useState<EditableUpstream[]>([]);
  const [models, setModels] = useState<EditableModel[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);

  const refreshSession = useEffectEvent(async () => {
    try {
      setSession(await fetchAdminSession());
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to read admin session",
      });
    }
  });

  const refreshAdminData = useEffectEvent(async () => {
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
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to load admin data",
      });
    }
  });

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (session.authenticated) {
      void refreshAdminData();
    }
  }, [refreshAdminData, session.authenticated]);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("login");

    try {
      const payload: LoginPayload = { username, password };
      const nextSession = await loginAdmin(payload);
      setSession(nextSession);
      setPassword("");
      setNotice({ tone: "success", message: "Signed in to admin console." });
      await refreshAdminData();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Login failed",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleLogout() {
    setBusy("logout");
    try {
      await logoutAdmin();
      setSession({ authenticated: false, username: null });
      setSettings(null);
      setDashboard(null);
      setUpstreams([]);
      setModels([]);
      setNotice({ tone: "success", message: "Logged out." });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Logout failed",
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
      };

      const nextSettings = await saveAdminSettings(payload);
      setSettings(nextSettings);
      setUpstreams(nextSettings.upstreams.map((upstream) => ({ ...upstream, newApiKey: "" })));
      setNotice({ tone: "success", message: "Runtime settings saved." });
      await refreshAdminData();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to save settings",
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
      setNotice({ tone: "success", message: "Model display metadata saved." });
      await refreshAdminData();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to save model metadata",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleAction(action: "sync" | "probe") {
    setBusy(action);

    try {
      const result: AdminActionResponse = action === "sync" ? await syncCatalogNow() : await probeNow();
      setNotice({ tone: "success", message: result.message });
      await refreshAdminData();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Action failed",
      });
    } finally {
      setBusy(null);
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

  if (!session.authenticated) {
    return (
      <section className="stack">
        <div className="hero panel">
          <div className="hero-copy">
            <p className="eyebrow">Protected Console</p>
            <h2>Admin Sign-In</h2>
            <p>Use the Worker secrets `ADMIN_USERNAME` and `ADMIN_PASSWORD` to unlock upstream and probe controls.</p>
          </div>
        </div>

        <form className="login-panel panel" onSubmit={handleLogin}>
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button className="button button-primary" type="submit" disabled={busy === "login"}>
            {busy === "login" ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {notice ? <div className={`notice notice-${notice.tone}`}>{notice.message}</div> : null}
      </section>
    );
  }

  return (
    <section className="stack">
      <div className="hero panel">
        <div className="hero-copy">
          <p className="eyebrow">Admin Console</p>
          <h2>{settings?.settings.siteTitle ?? "Loading runtime settings"}</h2>
          <p>Manage upstreams, tune probe thresholds, and trigger sync or probe runs on demand.</p>
        </div>
        <div className="toolbar">
          <button className="button" type="button" disabled={busy === "sync"} onClick={() => void handleAction("sync")}>
            {busy === "sync" ? "Syncing..." : "Sync catalog"}
          </button>
          <button className="button" type="button" disabled={busy === "probe"} onClick={() => void handleAction("probe")}>
            {busy === "probe" ? "Probing..." : "Run probe"}
          </button>
          <button className="button button-primary" type="button" disabled={busy === "settings"} onClick={() => void handleSaveSettings()}>
            {busy === "settings" ? "Saving..." : "Save settings"}
          </button>
          <button className="button button-primary" type="button" disabled={busy === "models"} onClick={() => void handleSaveModels()}>
            {busy === "models" ? "Saving..." : "Save models"}
          </button>
          <button className="button button-ghost" type="button" disabled={busy === "logout"} onClick={() => void handleLogout()}>
            {busy === "logout" ? "Leaving..." : "Logout"}
          </button>
        </div>
      </div>

      {notice ? <div className={`notice notice-${notice.tone}`}>{notice.message}</div> : null}

      {dashboard ? (
        <div className="summary-grid">
          <SummaryCard label="Visible models" value={String(dashboard.summary.totalModels)} detail={`Hidden ${dashboard.summary.hiddenModels}`} />
          <SummaryCard
            label="Healthy"
            value={String(dashboard.summary.availableModels)}
            detail={`Degraded ${dashboard.summary.degradedModels} / Down ${dashboard.summary.errorModels}`}
          />
          <SummaryCard label="Last catalog sync" value={formatTime(dashboard.meta.lastCatalogSyncAt)} detail={`Last probe ${formatTime(dashboard.meta.lastProbeAt)}`} />
          <SummaryCard label="Average latency" value={formatLatency(dashboard.summary.avgTotalLatencyMs)} detail={`Availability ${formatAvailability(dashboard.summary.availabilityPercentage)}`} />
        </div>
      ) : null}

      {settings ? (
        <div className="admin-grid">
          <section className="panel stack">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Runtime</p>
                <h3>Probe and classification settings</h3>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Site title</span>
                <input value={settings.settings.siteTitle} onChange={(event) => updateSetting("siteTitle", event.target.value)} />
              </label>
              <label className="field">
                <span>Site subtitle</span>
                <input value={settings.settings.siteSubtitle} onChange={(event) => updateSetting("siteSubtitle", event.target.value)} />
              </label>
              <label className="field">
                <span>Probe interval (ms)</span>
                <input type="number" value={settings.settings.probeIntervalMs} onChange={(event) => updateSetting("probeIntervalMs", Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Catalog sync interval (ms)</span>
                <input type="number" value={settings.settings.catalogSyncIntervalMs} onChange={(event) => updateSetting("catalogSyncIntervalMs", Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Probe timeout (ms)</span>
                <input type="number" value={settings.settings.probeTimeoutMs} onChange={(event) => updateSetting("probeTimeoutMs", Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Probe concurrency</span>
                <input type="number" value={settings.settings.probeConcurrency} onChange={(event) => updateSetting("probeConcurrency", Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Probe max tokens</span>
                <input type="number" value={settings.settings.probeMaxTokens} onChange={(event) => updateSetting("probeMaxTokens", Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Probe temperature</span>
                <input type="number" step="0.1" value={settings.settings.probeTemperature} onChange={(event) => updateSetting("probeTemperature", Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Healthy score threshold</span>
                <input type="number" value={settings.settings.modelStatusUpScoreThreshold} onChange={(event) => updateSetting("modelStatusUpScoreThreshold", Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Degraded score threshold</span>
                <input type="number" value={settings.settings.modelStatusDegradedScoreThreshold} onChange={(event) => updateSetting("modelStatusDegradedScoreThreshold", Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Degraded retries</span>
                <input type="number" value={settings.settings.degradedRetryAttempts} onChange={(event) => updateSetting("degradedRetryAttempts", Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Failed retries</span>
                <input type="number" value={settings.settings.failedRetryAttempts} onChange={(event) => updateSetting("failedRetryAttempts", Number(event.target.value))} />
              </label>
            </div>
          </section>

          <section className="panel stack">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Upstreams</p>
                <h3>OpenAI-compatible providers</h3>
              </div>
            </div>

            <div className="stack">
              {upstreams.map((upstream, index) => (
                <div key={upstream.id || `new-${index}`} className="upstream-card">
                  <div className="form-grid">
                    <label className="field">
                      <span>Name</span>
                      <input value={upstream.name} onChange={(event) => patchUpstream(index, { name: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>Group</span>
                      <input value={upstream.group} onChange={(event) => patchUpstream(index, { group: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>API base URL</span>
                      <input value={upstream.apiBaseUrl} onChange={(event) => patchUpstream(index, { apiBaseUrl: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>Models URL</span>
                      <input value={upstream.modelsUrl} onChange={(event) => patchUpstream(index, { modelsUrl: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>New API key</span>
                      <input
                        type="password"
                        placeholder={upstream.apiKeyMasked ?? "Paste only when rotating"}
                        value={upstream.newApiKey}
                        onChange={(event) => patchUpstream(index, { newApiKey: event.target.value })}
                      />
                    </label>
                    <label className="checkbox-field">
                      <input type="checkbox" checked={upstream.isActive} onChange={(event) => patchUpstream(index, { isActive: event.target.checked })} />
                      <span>Active</span>
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
                    name: "New Upstream",
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
              Add upstream
            </button>
          </section>
        </div>
      ) : (
        <div className="panel empty-state">Loading admin settings...</div>
      )}

      <section className="panel stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Models</p>
            <h3>Visibility, labels, and ordering</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="model-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Display name</th>
                <th>Icon</th>
                <th>Visible</th>
                <th>Sort</th>
                <th>Status</th>
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
                  <td>
                    <input type="checkbox" checked={model.isVisible} onChange={(event) => patchModel(index, { isVisible: event.target.checked })} />
                  </td>
                  <td>
                    <input type="number" value={model.sortOrder} onChange={(event) => patchModel(index, { sortOrder: Number(event.target.value) })} />
                  </td>
                  <td>
                    <span className={`status-pill ${statusClass(model.latestStatus)}`}>{statusLabel(model.latestStatus)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

export default function App() {
  const route = getRoute();

  return (
    <Shell>
      <main className="layout">
        <Topbar route={route} />
        {route === "admin" ? <AdminConsole /> : <PublicDashboard />}
      </main>
    </Shell>
  );
}
