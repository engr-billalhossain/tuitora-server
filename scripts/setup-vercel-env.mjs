#!/usr/bin/env node
/**
 * Push the backend keys from the local .env file into a Vercel project.
 *
 * One-time prerequisites (interactive, cannot be automated):
 *   npx vercel login
 *   npx vercel link --yes        # run from this repo root
 *
 * Then:
 *   npm run setup:vercel -- https://<your-frontend>.vercel.app
 *   npm run setup:vercel -- https://<your-frontend>.vercel.app --dry-run
 *
 * FRONTEND_URL is rewritten to the deployed URL. PORT / DB_USER / DB_PASSWORD
 * are intentionally NOT pushed (see DEPLOY.md): MONGODB_URI is built from the
 * local DB_USER + DB_PASSWORD instead. Secrets are masked in dry-run output.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [frontendUrlRaw] = args.filter((arg) => !arg.startsWith("--"));

if (!frontendUrlRaw) {
  console.error(
    "Usage: node scripts/setup-vercel-env.mjs <https://your-frontend.vercel.app> [--dry-run]"
  );
  process.exit(1);
}

function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    // Drop trailing inline comments such as `... # some note`.
    const comment = value.search(/\s+#/);
    if (comment !== -1) value = value.slice(0, comment).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function mask(value) {
  if (!value) return "(missing - skipped)";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

const envPath = resolve(process.cwd(), ".env");
if (!existsSync(envPath)) {
  console.error(`No .env file found at ${envPath}`);
  process.exit(1);
}

const values = parseEnv(readFileSync(envPath, "utf8"));
const frontendUrl = frontendUrlRaw.replace(/\/$/, "");
const mongodbUri =
  values.MONGODB_URI ||
  (values.DB_USER && values.DB_PASSWORD
    ? `mongodb+srv://${encodeURIComponent(values.DB_USER)}:${encodeURIComponent(values.DB_PASSWORD)}@cluster0.xdlqhda.mongodb.net/?retryWrites=true&w=majority`
    : undefined);

const payload = {
  MONGODB_URI: mongodbUri,
  JWT_SECRET: values.JWT_SECRET || values.BETTER_AUTH_SECRET,
  BETTER_AUTH_SECRET: values.BETTER_AUTH_SECRET || values.JWT_SECRET,
  IMAGEBB_API_KEY: values.IMAGEBB_API_KEY,
  FRONTEND_URL: frontendUrl,
};

const targets = ["production", "preview", "development"];

for (const [key, value] of Object.entries(payload)) {
  if (!value) {
    console.log(`Skipping ${key} (missing from .env)`);
    continue;
  }
  for (const target of targets) {
    if (dryRun) {
      console.log(`[dry-run] ${key} -> ${target} (${mask(value)})`);
      continue;
    }

    const result = spawnSync("npx", ["--yes", "vercel@latest", "env", "add", key, target], {
      input: value,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (result.status !== 0) {
      console.error(
        `Failed to add ${key} (${target}):\n${result.stderr?.trim() || result.stdout?.trim()}`
      );
      process.exitCode = 1;
    } else {
      console.log(`Added ${key} -> ${target}`);
    }
  }
}

if (!dryRun) {
  console.log("\nDone. Redeploy the backend from the Vercel dashboard.");
}
