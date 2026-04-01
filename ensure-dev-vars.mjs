import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const examplePath = path.join(rootDir, ".dev.vars.example");
const localPath = path.join(rootDir, ".dev.vars");
const legacyPasswordLine = "ADMIN_PASSWORD=change-me";
const defaultPasswordLine = "ADMIN_PASSWORD=admin123";
const placeholderPasswordLine = "ADMIN_PASSWORD=replace-with-a-strong-password";
const placeholderSecretLine = "SESSION_SECRET=replace-with-a-long-random-string";

function hasMissingOrBlankValue(content, key) {
  const match = content.match(new RegExp(`^${key}=(.*)$`, "mu"));
  return !match || !match[1].trim();
}

function randomValue(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function upsertLine(content, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, "mu");
  const nextLine = `${key}=${value}`;

  if (pattern.test(content)) {
    return content.replace(pattern, nextLine);
  }

  const suffix = content.endsWith("\n") ? "" : "\n";
  return `${content}${suffix}${nextLine}\n`;
}

function ensureSecureDevSecrets(content) {
  let next = content;
  let changed = false;

  const weakPasswordPatterns = [
    new RegExp(`^${legacyPasswordLine.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"),
    new RegExp(`^${defaultPasswordLine.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"),
    new RegExp(`^${placeholderPasswordLine.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"),
  ];

  if (weakPasswordPatterns.some((pattern) => pattern.test(next)) || hasMissingOrBlankValue(next, "ADMIN_PASSWORD")) {
    next = upsertLine(next, "ADMIN_PASSWORD", randomValue(18));
    changed = true;
  }

  if (next.includes(placeholderSecretLine) || hasMissingOrBlankValue(next, "SESSION_SECRET")) {
    next = upsertLine(next, "SESSION_SECRET", randomValue(32));
    changed = true;
  }

  return { content: next, changed };
}

if (!existsSync(examplePath)) {
  process.exit(0);
}

if (!existsSync(localPath)) {
  copyFileSync(examplePath, localPath);
  const current = readFileSync(localPath, "utf8");
  const next = ensureSecureDevSecrets(current);
  if (next.changed) {
    writeFileSync(localPath, next.content, "utf8");
  }
  process.stdout.write("Created .dev.vars from .dev.vars.example with generated local admin credentials.\n");
  process.exit(0);
}

const current = readFileSync(localPath, "utf8");
const next = ensureSecureDevSecrets(current);
if (next.changed) {
  writeFileSync(localPath, next.content, "utf8");
  process.stdout.write("Refreshed weak or missing local admin credentials in .dev.vars.\n");
}
