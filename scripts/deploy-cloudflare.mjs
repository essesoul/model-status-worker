import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const workerDir = path.join(rootDir, "apps", "worker");
const webDir = path.join(rootDir, "apps", "web");
const workerConfigPath = path.join(workerDir, "wrangler.jsonc");
const workerTemplatePath = path.join(workerDir, "wrangler.template.jsonc");
const workerSecretsPath = path.join(workerDir, ".deploy-secrets.env");
const placeholderDatabaseId = "00000000-0000-0000-0000-000000000000";

function sanitizeName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

const repoName = sanitizeName(path.basename(rootDir) || "model-status-worker");
const projectName = sanitizeName(process.env.CF_PROJECT_NAME ?? repoName);
const workerName = sanitizeName(process.env.CF_WORKER_NAME ?? `${projectName}-api`);
const d1Name = sanitizeName(process.env.CF_D1_NAME ?? `${projectName}-db`);
const pagesProjectName = sanitizeName(process.env.CF_PAGES_PROJECT_NAME ?? projectName);
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const adminUsername = process.env.ADMIN_USERNAME?.trim() || "admin";
const adminPassword = process.env.ADMIN_PASSWORD?.trim();
const sessionSecret = process.env.SESSION_SECRET?.trim();
const appOrigin = process.env.APP_ORIGIN?.trim() || `https://${pagesProjectName}.pages.dev`;
const extraAllowedOrigins = process.env.EXTRA_ALLOWED_ORIGINS?.trim() || "";

function requireValue(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}${details ? `\n${details}` : ""}`,
    );
  }

  return result;
}

function npx(args, options = {}) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  return run(command, args, options);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureAuthenticated() {
  const result = npx(["wrangler", "whoami", "--json"]);
  const payload = JSON.parse(result.stdout);
  if (!payload.loggedIn) {
    throw new Error("Wrangler is not authenticated. Run `npx wrangler login` first.");
  }
}

function renderWorkerConfig() {
  const template = readJson(workerTemplatePath);
  const current = existsSync(workerConfigPath) ? readJson(workerConfigPath) : {};
  const currentBindings = Array.isArray(current.d1_databases) ? current.d1_databases : [];
  const hasRealD1Binding = currentBindings.some((binding) => binding.database_id && binding.database_id !== placeholderDatabaseId);
  const rendered = {
    ...template,
    ...current,
    name: workerName,
    account_id: requireValue("CLOUDFLARE_ACCOUNT_ID", accountId),
    vars: {
      ...(template.vars ?? {}),
      ...(current.vars ?? {}),
      APP_ORIGIN: appOrigin,
      EXTRA_ALLOWED_ORIGINS: extraAllowedOrigins,
      ADMIN_USERNAME: adminUsername,
    },
  };

  if (hasRealD1Binding) {
    rendered.d1_databases = current.d1_databases;
  } else {
    delete rendered.d1_databases;
  }

  writeJson(workerConfigPath, rendered);
}

function ensureD1Binding() {
  const config = readJson(workerConfigPath);
  const d1Bindings = Array.isArray(config.d1_databases) ? config.d1_databases : [];
  const hasRealD1Binding = d1Bindings.some((binding) => binding.database_id && binding.database_id !== placeholderDatabaseId);
  if (hasRealD1Binding) {
    return;
  }

  npx([
    "wrangler",
    "d1",
    "create",
    d1Name,
    "--binding",
    "DB",
    "--update-config",
    "-c",
    workerConfigPath,
  ]);
}

function applyMigrations() {
  npx([
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "-c",
    workerConfigPath,
  ]);
}

function writeSecretsFile() {
  writeFileSync(
    workerSecretsPath,
    `ADMIN_PASSWORD=${requireValue("ADMIN_PASSWORD", adminPassword)}\nSESSION_SECRET=${requireValue("SESSION_SECRET", sessionSecret)}\n`,
    "utf8",
  );
}

function deployWorker() {
  const result = npx([
    "wrangler",
    "deploy",
    "-c",
    workerConfigPath,
    "--keep-vars",
    "--secrets-file",
    workerSecretsPath,
  ]);

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const match = combinedOutput.match(/https:\/\/[^\s]+\.workers\.dev/iu);
  if (!match) {
    throw new Error("Worker deployed, but the workers.dev URL could not be detected from Wrangler output.");
  }

  return match[0];
}

function buildWeb(workerUrl) {
  run(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "build", "--workspace", "@model-status/web"],
    {
      env: {
        ...process.env,
        VITE_API_BASE_URL: workerUrl,
      },
    },
  );
}

function ensurePagesProject() {
  try {
    npx([
      "wrangler",
      "pages",
      "project",
      "create",
      pagesProjectName,
      "--production-branch",
      "main",
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const existingProjectPattern = /already exists/iu;
    if (!existingProjectPattern.test(message)) {
      throw error;
    }
  }
}

function deployPages() {
  npx([
    "wrangler",
    "pages",
    "deploy",
    path.join(webDir, "dist"),
    "--project-name",
    pagesProjectName,
    "--branch",
    "main",
  ]);
}

try {
  ensureAuthenticated();
  renderWorkerConfig();
  ensureD1Binding();
  applyMigrations();
  writeSecretsFile();

  const workerUrl = deployWorker();
  buildWeb(workerUrl);
  ensurePagesProject();
  deployPages();

  process.stdout.write(`\nWorker URL: ${workerUrl}\n`);
  process.stdout.write(`Pages URL: ${appOrigin}\n`);
} finally {
  if (existsSync(workerSecretsPath)) {
    unlinkSync(workerSecretsPath);
  }
}
