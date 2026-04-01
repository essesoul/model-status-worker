import type {
  AdminActionResponse,
  AdminDashboardResponse,
  AdminSessionResponse,
  AdminSettingsResponse,
  DashboardRange,
  DashboardResponse,
  LoginRequest,
  ProbeStreamEvent,
  UpdateAdminModelsRequest,
  UpdateAdminSettingsRequest,
} from "./shared";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/u, "");

function apiPath(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

async function readError(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw.trim()) {
    return `Request failed with status ${response.status}`;
  }

  try {
    const json = JSON.parse(raw) as { error?: string };
    return json.error ?? raw;
  } catch {
    return raw;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), init);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json() as Promise<T>;
}

export type LoginPayload = LoginRequest;
export type UpstreamPayload = NonNullable<UpdateAdminSettingsRequest["upstreams"]>[number];
export type AdminModelsPayload = UpdateAdminModelsRequest;
export type ProbeStreamMessage =
  | { event: "ready"; data: { ok: true } }
  | { event: "probe-event"; data: ProbeStreamEvent }
  | { event: "done"; data: { startedAt: string; finishedAt: string; total: number; succeeded: number; failed: number } }
  | { event: "fatal"; data: { message: string } };

function parseSseBuffer(buffer: string): { messages: Array<{ event: string; data: string }>; remainder: string } {
  const blocks = buffer.replace(/\r\n/gu, "\n").split("\n\n");
  const remainder = blocks.pop() ?? "";
  const messages = blocks
    .map((block) => {
      const lines = block.split("\n");
      let event = "message";
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }

      return {
        event,
        data: dataLines.join("\n"),
      };
    })
    .filter((message) => message.data.length > 0);

  return { messages, remainder };
}

export function fetchDashboard(range: DashboardRange): Promise<DashboardResponse> {
  return request<DashboardResponse>(`/api/dashboard?range=${range}`);
}

export function fetchAdminSession(): Promise<AdminSessionResponse> {
  return request<AdminSessionResponse>("/api/admin/session", {
    credentials: "include",
  });
}

export function loginAdmin(payload: LoginPayload): Promise<AdminSessionResponse> {
  return request<AdminSessionResponse>("/api/admin/login", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function logoutAdmin(): Promise<AdminSessionResponse> {
  return request<AdminSessionResponse>("/api/admin/logout", {
    method: "POST",
    credentials: "include",
  });
}

export function fetchAdminSettings(): Promise<AdminSettingsResponse> {
  return request<AdminSettingsResponse>("/api/admin/settings", {
    credentials: "include",
  });
}

export function saveAdminSettings(payload: UpdateAdminSettingsRequest): Promise<AdminSettingsResponse> {
  return request<AdminSettingsResponse>("/api/admin/settings", {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function fetchAdminDashboard(range: DashboardRange): Promise<AdminDashboardResponse> {
  return request<AdminDashboardResponse>(`/api/admin/dashboard?range=${range}`, {
    credentials: "include",
  });
}

export function saveAdminModels(payload: AdminModelsPayload): Promise<AdminActionResponse> {
  return request<AdminActionResponse>("/api/admin/models", {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function syncCatalogNow(): Promise<AdminActionResponse> {
  return request<AdminActionResponse>("/api/admin/actions/sync", {
    method: "POST",
    credentials: "include",
  });
}

export function cleanupOutdatedDataNow(): Promise<AdminActionResponse> {
  return request<AdminActionResponse>("/api/admin/actions/cleanup", {
    method: "POST",
    credentials: "include",
  });
}

export function probeNow(): Promise<AdminActionResponse> {
  return request<AdminActionResponse>("/api/admin/actions/probe", {
    method: "POST",
    credentials: "include",
  });
}

export async function streamProbeLogs(
  onMessage: (message: ProbeStreamMessage) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(apiPath("/api/admin/actions/probe/stream"), {
    method: "POST",
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  if (!response.body) {
    throw new Error("Probe log stream is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
    } else {
      buffer += decoder.decode(value, { stream: true });
    }

    const { messages, remainder } = parseSseBuffer(buffer);
    buffer = remainder;

    for (const message of messages) {
      onMessage({
        event: message.event as ProbeStreamMessage["event"],
        data: JSON.parse(message.data) as ProbeStreamMessage["data"],
      } as ProbeStreamMessage);
    }

    if (done) {
      break;
    }
  }
}
