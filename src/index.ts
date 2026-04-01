import type {
  AdminActionResponse,
  AdminSessionResponse,
  DashboardRange,
  LoginRequest,
  ProbeStreamEvent,
  UpdateAdminModelsRequest,
  UpdateAdminSettingsRequest,
} from "./shared";
import { isDashboardRange } from "./shared";
import { Hono } from "hono";

import {
  clearSessionCookie,
  createSessionCookie,
  getCorsAdminOrigin,
  getSession,
  isAllowedAdminOrigin,
  isValidLogin,
} from "./auth";
import { getDashboardData } from "./dashboard";
import { probeAllModels, runDueJobs, syncModelCatalog } from "./jobs";
import {
  deleteModelsByKeys,
  ensureBootstrap,
  getAdminSettingsResponse,
  getRuntimeSettings,
  listModels,
  updateAdminSettings,
  updateModelMetadata,
} from "./store";

type Bindings = {
  DB: D1Database;
  APP_ORIGIN?: string;
  EXTRA_ALLOWED_ORIGINS?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

function applyPublicCors(c: { header: (name: string, value: string) => void }) {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  c.header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
}

function createSseResponse(
  run: (send: (event: string, data: unknown) => Promise<void>) => Promise<void>,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      async function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        await run(send);
      } catch (error) {
        await send("fatal", {
          message: error instanceof Error ? error.message : "Internal probe stream error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}

function applyAdminCors(
  c: {
    req: { raw: Request };
    env: Bindings;
    header: (name: string, value: string) => void;
  },
): boolean {
  if (!isAllowedAdminOrigin(c.req.raw, c.env.APP_ORIGIN, c.env.EXTRA_ALLOWED_ORIGINS)) {
    return false;
  }

  const origin = getCorsAdminOrigin(c.req.raw);
  if (!origin) {
    return true;
  }

  c.header("Access-Control-Allow-Origin", origin);
  c.header("Vary", "Origin");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  c.header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  c.header("Access-Control-Allow-Credentials", "true");
  return true;
}

async function requireAdmin(c: {
  req: { raw: Request };
  env: Bindings;
  json: (body: unknown, status?: number) => Response;
  header: (name: string, value: string) => void;
}): Promise<AdminSessionResponse | Response> {
  if (!applyAdminCors(c)) {
    return c.json({ error: "Invalid origin" }, 403);
  }

  const session = await getSession(c.req.raw, c.env.SESSION_SECRET);
  if (!session.authenticated) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return session;
}

app.use("/api/*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    if (c.req.path.startsWith("/api/admin")) {
      if (!applyAdminCors(c)) {
        return c.json({ error: "Invalid origin" }, 403);
      }
      return c.body(null, 204);
    }

    applyPublicCors(c);
    return c.body(null, 204);
  }

  await next();

  if (c.req.path.startsWith("/api/admin")) {
    applyAdminCors(c);
    return;
  }

  applyPublicCors(c);
});

app.get("/api/health", async (c) => {
  await ensureBootstrap(c.env.DB);
  return c.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/dashboard", async (c) => {
  const rangeParam = c.req.query("range") ?? "90m";
  if (!isDashboardRange(rangeParam)) {
    return c.json({ error: "Invalid range. Use one of: 90m,24h,7d,30d" }, 400);
  }

  const settings = await getRuntimeSettings(c.env.DB);
  const payload = await getDashboardData(c.env.DB, rangeParam, settings, true);
  return c.json(payload);
});

app.get("/api/admin/session", async (c) => {
  if (!applyAdminCors(c)) {
    return c.json({ error: "Invalid origin" }, 403);
  }

  return c.json(await getSession(c.req.raw, c.env.SESSION_SECRET));
});

app.post("/api/admin/login", async (c) => {
  if (!applyAdminCors(c)) {
    return c.json({ error: "Invalid origin" }, 403);
  }

  const payload = await c.req.json<LoginRequest>();
  const username = c.env.ADMIN_USERNAME?.trim() || "admin";
  if (!isValidLogin(payload.username, payload.password, username, c.env.ADMIN_PASSWORD)) {
    return c.json({ error: "Invalid username or password" }, 401);
  }

  c.header("Set-Cookie", await createSessionCookie(c.req.raw, username, c.env.SESSION_SECRET));
  return c.json({
    authenticated: true,
    username,
  } satisfies AdminSessionResponse);
});

app.post("/api/admin/logout", async (c) => {
  if (!applyAdminCors(c)) {
    return c.json({ error: "Invalid origin" }, 403);
  }

  c.header("Set-Cookie", clearSessionCookie(c.req.raw));
  return c.json({
    authenticated: false,
    username: null,
  } satisfies AdminSessionResponse);
});

app.get("/api/admin/settings", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) {
    return session;
  }

  return c.json(await getAdminSettingsResponse(c.env.DB));
});

app.put("/api/admin/settings", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) {
    return session;
  }

  const payload = await c.req.json<UpdateAdminSettingsRequest>();
  return c.json(await updateAdminSettings(c.env.DB, payload));
});

app.get("/api/admin/dashboard", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) {
    return session;
  }

  const rangeParam = c.req.query("range") ?? "24h";
  const range = isDashboardRange(rangeParam) ? rangeParam : ("24h" as DashboardRange);
  const settings = await getRuntimeSettings(c.env.DB);
  return c.json(await getDashboardData(c.env.DB, range, settings, false));
});

app.put("/api/admin/models", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) {
    return session;
  }

  const payload = await c.req.json<UpdateAdminModelsRequest>();
  const keepKeys = new Set<string>();

  for (const model of payload.models ?? []) {
    keepKeys.add(`${model.upstreamId}::${model.id}`);
    await updateModelMetadata(c.env.DB, {
      upstreamId: model.upstreamId,
      id: model.id,
      displayName: model.displayName?.trim() || null,
      icon: model.icon?.trim() || null,
      isVisible: model.isVisible,
      sortOrder: Math.max(0, Math.trunc(model.sortOrder ?? 0)),
    });
  }

  const existingModels = await listModels(c.env.DB, true);
  const deleteKeys = existingModels
    .filter((model) => !keepKeys.has(`${model.upstreamId}::${model.id}`))
    .map((model) => ({
      upstreamId: model.upstreamId,
      id: model.id,
    }));

  await deleteModelsByKeys(c.env.DB, deleteKeys);

  return c.json({
    ok: true,
    message: "Model metadata updated",
  } satisfies AdminActionResponse);
});

app.post("/api/admin/actions/sync", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) {
    return session;
  }

  const result = await syncModelCatalog(c.env.DB);
  return c.json({
    ok: true,
    message: result.errors.length > 0
      ? `Catalog sync finished with ${result.errors.length} warning(s)`
      : "Catalog sync completed",
    detail: result,
  } satisfies AdminActionResponse);
});

app.post("/api/admin/actions/probe", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) {
    return session;
  }

  const result = await probeAllModels(c.env.DB);
  return c.json({
    ok: true,
    message: result.total === 0 ? "No active models to probe" : "Probe cycle completed",
    detail: result,
  } satisfies AdminActionResponse);
});

app.post("/api/admin/actions/probe/stream", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) {
    return session;
  }

  return createSseResponse(async (send) => {
    await send("ready", { ok: true });

    const result = await probeAllModels(c.env.DB, async (event: ProbeStreamEvent) => {
      await send("probe-event", event);
    });

    await send("done", result);
  });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: error.message || "Internal Server Error" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runDueJobs(env.DB));
  },
};
