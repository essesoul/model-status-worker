import type { DashboardRange, ProbeLevel } from "./shared";

export type Locale = "en" | "zh-CN";

const SYSTEM_TITLE_ALIASES = new Set([
  "Model Status",
  "Model Status Edge",
  "Model Status worker",
]);

const SYSTEM_SUBTITLE_ALIASES = new Set([
  "Cloudflare-native status board for OpenAI-compatible model APIs",
  "Single-worker status board for probe history, latency, and availability.",
  "Single-worker status board for probe history, latency, and health.",
]);

const MESSAGES = {
  en: {
    brandTitle: "Model Status",
    brandIconAlt: "Model Status icon",
    navPublic: "Status",
    headerMetaToggle: "Status data",
    systemTitle: "Model Status",
    systemSubtitle: "Single-worker status board for probe history, latency, and health.",
    documentTitlePublic: "Model Status",
    documentTitleAdmin: "Model Status Admin",
    publicKicker: "Public status",
    publicLoadingTitle: "Loading status board",
    publicLoadingBody: "Reading probe history from the Worker API.",
    lastProbe: "Last probe",
    nextProbe: "Next probe",
    lastCatalogSync: "Last model sync",
    rangeHintRunning: "A probe cycle is running now.",
    summaryHealthy: "Healthy",
    summaryHealthyDetail: (count: number) => `${count} visible models`,
    summaryDegraded: "Degraded",
    summaryDegradedDetail: (count: number) => `Down ${count}`,
    summaryAvailability: "Health",
    summaryAvailabilityDetail: (value: string) => `${value} models`,
    summaryLatency: "Total latency",
    summaryLatencyDetail: (value: string) => `First Token ${value}`,
    groupLabel: "Upstream group",
    groupCount: (count: number) => `${count} models`,
    publicEmpty: "No visible models yet. Add an API key in the admin page, sync models, then run a probe.",
    publicFooterPoweredBy: "Powered by",
    loadingDashboard: "Loading dashboard...",
    adminSignInKicker: "Admin access",
    adminSignInTitle: "Sign in",
    adminSignInBody: "Use the configured admin credentials to manage upstreams, thresholds, and probe jobs.",
    username: "Username",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in...",
    adminKicker: "Admin console",
    adminLoadingTitle: "Loading settings",
    adminBody: "Manage probe settings, provider connections, and model presentation.",
    actionSync: "Sync models",
    actionSyncing: "Syncing...",
    actionProbe: "Run probe",
    actionProbing: "Probing...",
    actionCleanup: "Clean outdated data",
    actionCleaning: "Cleaning...",
    actionSaveSettings: "Save settings",
    actionSaveModels: "Save models",
    actionSaving: "Saving...",
    actionLogout: "Log out",
    actionLeaving: "Logging out...",
    closeModal: "Close",
    probeModalTitle: "Probe logs",
    probeModalRunning: "Probe in progress",
    probeModalFinished: "Probe completed",
    probeModalFailed: "Probe failed",
    summaryVisible: "Visible models",
    summaryVisibleDetail: (count: number) => `Hidden ${count}`,
    summaryHealthyShort: "Healthy",
    summaryHealthyShortDetail: (degraded: number, down: number) => `Degraded ${degraded} / Down ${down}`,
    summaryLastCatalogSync: "Last model sync",
    summaryLastCatalogSyncDetail: (value: string) => `Last probe ${value}`,
    summaryAverageLatency: "Average latency",
    summaryAverageLatencyDetail: (value: string) => `Health ${value}`,
    runtimeKicker: "Runtime",
    runtimeTitle: "Probe and classification",
    runtimeBody: "These values control intervals, retry behavior, and status scoring.",
    fieldSiteTitle: "Site title",
    fieldSiteSubtitle: "Site subtitle",
    fieldShowSummaryCards: "Show summary metrics",
    fieldProbeInterval: "Probe interval (ms)",
    fieldCatalogSyncInterval: "Model sync interval (ms, 0 disables auto sync)",
    fieldProbeTimeout: "Probe timeout (ms)",
    fieldProbeConcurrency: "Probe concurrency",
    fieldProbeMaxTokens: "Probe max tokens",
    fieldProbeTemperature: "Probe temperature",
    fieldHealthyThreshold: "Healthy threshold",
    fieldDegradedThreshold: "Degraded threshold",
    fieldDegradedRetries: "Degraded retries",
    fieldFailedRetries: "Failed retries",
    fieldTurnstileEnabled: "Enable Turnstile",
    fieldTurnstileSiteKey: "Turnstile site key",
    fieldTurnstileSecretKey: "Turnstile secret key",
    fieldStoredSecret: "Stored secret",
    storedSecretMissing: "Not configured",
    turnstileSecretPlaceholder: "Only paste when adding or rotating the secret key",
    upstreamKicker: "Upstreams",
    upstreamTitle: "Provider connections",
    upstreamBody: "Each upstream can use its own base URL, model list URL, and API key.",
    fieldName: "Name",
    fieldGroup: "Group",
    fieldApiBaseUrl: "API base URL",
    fieldModelsUrl: "Models URL",
    fieldNewApiKey: "New API key",
    fieldActive: "Active",
    inactiveStatus: "Inactive",
    fieldStoredApiKey: "Stored key",
    storedApiKeyMissing: "Not configured",
    apiKeyPlaceholder: "Only paste a key when rotating or adding credentials",
    addUpstream: "Add upstream",
    deleteUpstream: "Delete",
    noticeUpstreamRemoved: "Upstream removed from the draft. Save settings to apply.",
    draftUpstreamName: "New upstream",
    modelsKicker: "Models",
    modelsTitle: "Visibility and display",
    modelsBody: "Control labels, icon glyphs, visibility, and sort order for public pages.",
    tableModel: "Model",
    tableDisplayName: "Display name",
    tableIcon: "Icon",
    tableVisible: "Visible",
    tableSort: "Sort",
    tableStatus: "Status",
    tableActions: "Actions",
    deleteModel: "Delete",
    emptyModelsAdmin: "No models available yet. Sync models to load model rows.",
    loadingAdminSettings: "Loading admin settings...",
    statusTimelineAria: "Recent model status",
    metricAvailability: "Health",
    metricFirstToken: "First Token",
    metricTotal: "Total",
    statusUp: "Healthy",
    statusDegraded: "Degraded",
    statusDown: "Down",
    statusEmpty: "No data",
    statusTitle: (status: string, started: string, ended: string, score: string) => `${status} | ${started} - ${ended} | ${score}`,
    rangeLabels: {
      "30h": "30h",
      "24h": "24h",
      "7d": "7d",
      "30d": "30d",
    } satisfies Record<DashboardRange, string>,
    timelineUnitHours: "Hours",
    timelineUnitDays: "Days",
    noticeSignedIn: "Signed in.",
    noticeLoggedOut: "Logged out.",
    noticeSettingsSaved: "Settings saved.",
    noticeModelsSaved: "Model display settings saved.",
    noticeModelRemoved: "Model removed from the draft. Save models to apply.",
    noticeProbeRefresh: "Probe results refreshed.",
    noticeCleanupCompleted: (count: number) =>
      `Cleaned up ${count} outdated status ${count === 1 ? "record" : "records"}.`,
    errorLoadDashboard: "Failed to load the dashboard.",
    errorReadSession: "Failed to read the admin session.",
    errorLoadAdminData: "Failed to load admin data.",
    errorLogin: "Login failed.",
    errorSaveSettings: "Failed to save settings.",
    errorSaveModels: "Failed to save model settings.",
    errorAction: "Action failed.",
    messageInvalidCredentials: "Invalid username or password.",
    messageUnauthorized: "Unauthorized.",
    messageInvalidOrigin: "Invalid origin.",
    messageInvalidRange: "Invalid range. Use 30h, 24h, 7d, or 30d.",
    messageTurnstileRequired: "Turnstile verification is required.",
    messageTurnstileFailed: "Turnstile verification failed.",
    messageTurnstileIncomplete: "Turnstile requires both site key and secret key before it can be enabled.",
    messageModelsUpdated: "Model metadata updated.",
    messageCatalogSyncCompleted: "Model sync completed.",
    messageCatalogWarnings: (count: number) => `Model sync finished with ${count} warning(s).`,
    messageNoActiveModels: "No active models to probe.",
    messageProbeCompleted: "Probe cycle completed.",
    messageCleanupCompleted: "Outdated status data cleaned up.",
    messageRequestFailed: (status: number) => `Request failed with status ${status}.`,
    messageProbeTimeout: "The probe request timed out.",
    messageProbeStreamUnreadable: "The upstream stream did not contain a parseable completion payload.",
    messageProbeStreamNoContent: "The upstream stream completed without content tokens.",
    probeLogCycleStarted: (total: number) => `Starting probe cycle for ${total} models.`,
    probeLogAttemptStarted: (upstreamName: string, model: string, attempt: number) =>
      `${upstreamName} / ${model}: starting attempt ${attempt}.`,
    probeLogAttemptSuccess: (
      upstreamName: string,
      model: string,
      classification: string,
      score: number,
      totalLatency: string,
      firstTokenLatency: string,
    ) => `${upstreamName} / ${model}: ${classification}, score ${score}, total ${totalLatency}, First Token ${firstTokenLatency}.`,
    probeLogAttemptFailure: (upstreamName: string, model: string, attempt: number, detail: string) =>
      `${upstreamName} / ${model}: attempt ${attempt} failed, ${detail}.`,
    probeLogCycleFinished: (total: number, succeeded: number, failed: number) =>
      `Probe cycle finished. Total ${total}, succeeded ${succeeded}, failed ${failed}.`,
    probeLogStreamFailed: (detail: string) => `Probe stream failed: ${detail}`,
    emptyValue: "--",
  },
  "zh-CN": {
    brandTitle: "模型状态",
    brandIconAlt: "模型状态图标",
    navPublic: "状态页",
    headerMetaToggle: "\u72b6\u6001\u6570\u636e",
    systemTitle: "模型状态",
    systemSubtitle: "在单个 Worker 中查看探测历史、延迟和可用率。",
    documentTitlePublic: "模型状态",
    documentTitleAdmin: "模型状态管理",
    publicKicker: "公开状态",
    publicLoadingTitle: "正在加载状态页",
    publicLoadingBody: "正在从 Worker API 读取探测历史。",
    lastProbe: "最近探测",
    nextProbe: "下一次探测",
    lastCatalogSync: "最近模型同步",
    rangeHintRunning: "当前正在执行一轮探测。",
    summaryHealthy: "正常",
    summaryHealthyDetail: (count: number) => `${count} 个可见模型`,
    summaryDegraded: "降级",
    summaryDegradedDetail: (count: number) => `不可用 ${count}`,
    summaryAvailability: "可用率",
    summaryAvailabilityDetail: (value: string) => `共 ${value} 个模型`,
    summaryLatency: "总延迟",
    summaryLatencyDetail: (value: string) => `首字延时 ${value}`,
    groupLabel: "上游分组",
    groupCount: (count: number) => `${count} 个模型`,
    publicEmpty: "当前还没有可见模型。请先在管理页添加 API Key，同步模型后再执行探测。",
    publicFooterPoweredBy: "Powered by",
    loadingDashboard: "正在加载状态页...",
    adminSignInKicker: "管理入口",
    adminSignInTitle: "登录",
    adminSignInBody: "使用已配置的管理员凭据来管理上游、阈值和探测任务。",
    username: "用户名",
    password: "密码",
    signIn: "登录",
    signingIn: "登录中...",
    adminKicker: "管理控制台",
    adminLoadingTitle: "正在加载设置",
    adminBody: "管理探测参数、上游连接和模型展示方式。",
    actionSync: "同步模型",
    actionSyncing: "同步中...",
    actionProbe: "执行探测",
    actionProbing: "探测中...",
    actionCleanup: "清理过时数据",
    actionCleaning: "清理中...",
    actionSaveSettings: "保存设置",
    actionSaveModels: "保存模型",
    actionSaving: "保存中...",
    actionLogout: "退出登录",
    actionLeaving: "退出中...",
    closeModal: "关闭",
    probeModalTitle: "探测日志",
    probeModalRunning: "探测进行中",
    probeModalFinished: "探测完成",
    probeModalFailed: "探测失败",
    summaryVisible: "可见模型",
    summaryVisibleDetail: (count: number) => `隐藏 ${count}`,
    summaryHealthyShort: "正常",
    summaryHealthyShortDetail: (degraded: number, down: number) => `降级 ${degraded} / 不可用 ${down}`,
    summaryLastCatalogSync: "最近模型同步",
    summaryLastCatalogSyncDetail: (value: string) => `最近探测 ${value}`,
    summaryAverageLatency: "平均延迟",
    summaryAverageLatencyDetail: (value: string) => `可用率 ${value}`,
    runtimeKicker: "运行参数",
    runtimeTitle: "探测与分级",
    runtimeBody: "这些值用于控制执行间隔、重试策略和状态评分阈值。",
    fieldSiteTitle: "站点标题",
    fieldSiteSubtitle: "站点副标题",
    fieldShowSummaryCards: "显示汇总指标",
    fieldProbeInterval: "探测间隔（毫秒）",
    fieldCatalogSyncInterval: "模型同步间隔（毫秒，0 表示禁用自动同步）",
    fieldProbeTimeout: "探测超时（毫秒）",
    fieldProbeConcurrency: "探测并发数",
    fieldProbeMaxTokens: "探测最大 tokens",
    fieldProbeTemperature: "探测温度",
    fieldHealthyThreshold: "正常阈值",
    fieldDegradedThreshold: "降级阈值",
    fieldDegradedRetries: "降级重试次数",
    fieldFailedRetries: "失败重试次数",
    fieldTurnstileEnabled: "启用 Turnstile",
    fieldTurnstileSiteKey: "Turnstile Site Key",
    fieldTurnstileSecretKey: "Turnstile Secret Key",
    fieldStoredSecret: "已存储密钥",
    storedSecretMissing: "未配置",
    turnstileSecretPlaceholder: "仅在新增或轮换密钥时填写",
    upstreamKicker: "上游配置",
    upstreamTitle: "供应商连接",
    upstreamBody: "每个上游都可以配置独立的基础地址、模型列表地址和 API Key。",
    fieldName: "名称",
    fieldGroup: "分组",
    fieldApiBaseUrl: "API 基础地址",
    fieldModelsUrl: "模型列表地址",
    fieldNewApiKey: "新的 API Key",
    fieldActive: "启用",
    inactiveStatus: "未启用",
    fieldStoredApiKey: "已存储 Key",
    storedApiKeyMissing: "未配置",
    apiKeyPlaceholder: "仅在新增或轮换凭据时填写",
    addUpstream: "新增上游",
    deleteUpstream: "删除",
    noticeUpstreamRemoved: "上游已从当前编辑列表中移除，保存设置后生效。",
    draftUpstreamName: "新上游",
    modelsKicker: "模型管理",
    modelsTitle: "可见性与展示",
    modelsBody: "控制公开页面中的模型名称、图标、显示状态和排序。",
    tableModel: "模型",
    tableDisplayName: "显示名称",
    tableIcon: "图标",
    tableVisible: "可见",
    tableSort: "排序",
    tableStatus: "状态",
    tableActions: "操作",
    deleteModel: "删除",
    emptyModelsAdmin: "当前还没有模型。请先同步模型。",
    loadingAdminSettings: "正在加载管理设置...",
    statusTimelineAria: "最近模型状态",
    metricAvailability: "可用率",
    metricFirstToken: "首字延时",
    metricTotal: "总耗时",
    statusUp: "正常",
    statusDegraded: "降级",
    statusDown: "不可用",
    statusEmpty: "无数据",
    statusTitle: (status: string, started: string, ended: string, score: string) => `${status} | ${started} - ${ended} | ${score}`,
    rangeLabels: {
      "30h": "30 小时",
      "24h": "24 小时",
      "7d": "7 天",
      "30d": "30 天",
    } satisfies Record<DashboardRange, string>,
    timelineUnitHours: "小时",
    timelineUnitDays: "天",
    noticeSignedIn: "已登录。",
    noticeLoggedOut: "已退出登录。",
    noticeSettingsSaved: "设置已保存。",
    noticeModelsSaved: "模型展示设置已保存。",
    noticeModelRemoved: "模型已从当前编辑列表中移除，保存模型后生效。",
    noticeProbeRefresh: "探测结果已刷新。",
    noticeCleanupCompleted: (count: number) => `已清理 ${count} 条过时状态记录。`,
    errorLoadDashboard: "加载状态页失败。",
    errorReadSession: "读取管理会话失败。",
    errorLoadAdminData: "加载管理数据失败。",
    errorLogin: "登录失败。",
    errorSaveSettings: "保存设置失败。",
    errorSaveModels: "保存模型设置失败。",
    errorAction: "操作失败。",
    messageInvalidCredentials: "用户名或密码错误。",
    messageUnauthorized: "未授权。",
    messageInvalidOrigin: "来源无效。",
    messageInvalidRange: "时间范围无效，请使用 30h、24h、7d 或 30d。",
    messageTurnstileRequired: "需要完成 Turnstile 校验。",
    messageTurnstileFailed: "Turnstile 校验失败。",
    messageTurnstileIncomplete: "启用 Turnstile 前需要同时填写 Site Key 和 Secret Key。",
    messageModelsUpdated: "模型元数据已更新。",
    messageCatalogSyncCompleted: "模型同步完成。",
    messageCatalogWarnings: (count: number) => `模型同步完成，包含 ${count} 条警告。`,
    messageNoActiveModels: "当前没有可探测的启用模型。",
    messageProbeCompleted: "探测任务已完成。",
    messageCleanupCompleted: "过时状态数据已清理。",
    messageRequestFailed: (status: number) => `请求失败，状态码 ${status}。`,
    messageProbeTimeout: "探测请求超时。",
    messageProbeStreamUnreadable: "上游流中没有可解析的补全内容。",
    messageProbeStreamNoContent: "上游流结束时没有返回内容 token。",
    probeLogCycleStarted: (total: number) => `开始探测，共 ${total} 个模型。`,
    probeLogAttemptStarted: (upstreamName: string, model: string, attempt: number) =>
      `${upstreamName} / ${model}：开始第 ${attempt} 次尝试。`,
    probeLogAttemptSuccess: (
      upstreamName: string,
      model: string,
      classification: string,
      score: number,
      totalLatency: string,
      firstTokenLatency: string,
    ) => `${upstreamName} / ${model}：${classification}，评分 ${score}，总耗时 ${totalLatency}，首字延时 ${firstTokenLatency}。`,
    probeLogAttemptFailure: (upstreamName: string, model: string, attempt: number, detail: string) =>
      `${upstreamName} / ${model}：第 ${attempt} 次尝试失败，${detail}。`,
    probeLogCycleFinished: (total: number, succeeded: number, failed: number) =>
      `探测结束，共 ${total} 个模型，成功 ${succeeded}，失败 ${failed}。`,
    probeLogStreamFailed: (detail: string) => `探测日志流失败：${detail}`,
    emptyValue: "--",
  },
} as const;

export type Messages = (typeof MESSAGES)[Locale];

function hasChineseLanguage(value: string | undefined): boolean {
  return Boolean(value && value.toLowerCase().startsWith("zh"));
}

export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") {
    return "en";
  }

  const languages = [...(navigator.languages ?? []), navigator.language];
  return languages.some((value) => hasChineseLanguage(value)) ? "zh-CN" : "en";
}

export function getMessages(locale: Locale): Messages {
  return MESSAGES[locale];
}

export function resolveSystemTitle(value: string | null | undefined, locale: Locale): string {
  const trimmed = value?.trim();
  if (!trimmed || SYSTEM_TITLE_ALIASES.has(trimmed)) {
    return MESSAGES[locale].systemTitle;
  }

  return trimmed;
}

export function resolveSystemSubtitle(value: string | null | undefined, locale: Locale): string {
  const trimmed = value?.trim();
  if (!trimmed || SYSTEM_SUBTITLE_ALIASES.has(trimmed)) {
    return MESSAGES[locale].systemSubtitle;
  }

  return trimmed;
}

export function localizeRuntimeMessage(message: string, locale: Locale): string {
  const copy = MESSAGES[locale];
  const trimmed = message.trim();

  switch (trimmed) {
    case "Invalid username or password":
      return copy.messageInvalidCredentials;
    case "Unauthorized":
      return copy.messageUnauthorized;
    case "Invalid origin":
      return copy.messageInvalidOrigin;
    case "Invalid range. Use one of: 30h,24h,7d,30d":
      return copy.messageInvalidRange;
    case "Turnstile verification is required":
      return copy.messageTurnstileRequired;
    case "Turnstile verification failed":
      return copy.messageTurnstileFailed;
    case "Turnstile requires both site key and secret key before it can be enabled":
      return copy.messageTurnstileIncomplete;
    case "Model metadata updated":
      return copy.messageModelsUpdated;
    case "Catalog sync completed":
    case "Model sync completed":
      return copy.messageCatalogSyncCompleted;
    case "No active models to probe":
      return copy.messageNoActiveModels;
    case "Probe cycle completed":
      return copy.messageProbeCompleted;
    case "Outdated status data cleaned up.":
      return copy.messageCleanupCompleted;
    case "The operation was aborted due to timeout":
      return copy.messageProbeTimeout;
    case "Upstream stream did not contain a parseable completion payload":
      return copy.messageProbeStreamUnreadable;
    case "Upstream stream completed without content tokens":
      return copy.messageProbeStreamNoContent;
  }

  const warningMatch = trimmed.match(/^(?:Catalog|Model) sync finished with (\d+) warning\(s\)$/u);
  if (warningMatch) {
    return copy.messageCatalogWarnings(Number(warningMatch[1]));
  }

  const turnstileFailureMatch = trimmed.match(/^Turnstile verification failed: /u);
  if (turnstileFailureMatch) {
    return copy.messageTurnstileFailed;
  }

  const statusMatch = trimmed.match(/^Request failed with status (\d+)$/u);
  if (statusMatch) {
    return copy.messageRequestFailed(Number(statusMatch[1]));
  }

  return trimmed;
}

export function statusLabel(level: ProbeLevel, locale: Locale): string {
  const copy = MESSAGES[locale];

  switch (level) {
    case "up":
      return copy.statusUp;
    case "degraded":
      return copy.statusDegraded;
    case "down":
      return copy.statusDown;
    case "empty":
      return copy.statusEmpty;
  }
}
