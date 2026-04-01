import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const examplePath = path.join(rootDir, ".dev.vars.example");
const localPath = path.join(rootDir, ".dev.vars");
const legacyPasswordLine = "ADMIN_PASSWORD=change-me";
const defaultPasswordLine = "ADMIN_PASSWORD=admin123";

if (!existsSync(examplePath)) {
  process.exit(0);
}

if (!existsSync(localPath)) {
  copyFileSync(examplePath, localPath);
  process.stdout.write("Created .dev.vars from .dev.vars.example for local development.\n");
  process.exit(0);
}

const current = readFileSync(localPath, "utf8");

if (current.includes(legacyPasswordLine)) {
  writeFileSync(localPath, current.replace(legacyPasswordLine, defaultPasswordLine), "utf8");
  process.stdout.write("Updated legacy local ADMIN_PASSWORD to admin123 in .dev.vars.\n");
  process.exit(0);
}

if (!current.includes("ADMIN_PASSWORD=")) {
  const next = current.endsWith("\n") ? current : `${current}\n`;
  writeFileSync(localPath, `${next}${defaultPasswordLine}\n`, "utf8");
  process.stdout.write("Added missing ADMIN_PASSWORD=admin123 to .dev.vars.\n");
}
