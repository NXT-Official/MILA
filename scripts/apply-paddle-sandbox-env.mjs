#!/usr/bin/env node
/**
 * Apply the three Paddle SANDBOX credentials to Vercel (production + preview),
 * update MILA/.env.local, and trigger a production redeploy.
 *
 * The values live only in the user's Paddle sandbox dashboard
 * (sandbox-vendors.paddle.com — separate login from live):
 *   PADDLE_SANDBOX_API_KEY        Developer tools > Authentication > API keys       (pdl_sdbx_apikey_…)
 *   VITE_PADDLE_CLIENT_TOKEN      same screen > Client-side tokens                   (test_…)
 *   PADDLE_SANDBOX_WEBHOOK_SECRET Developer tools > Notifications > destination secret
 *
 * Usage (from the MILA repo):
 *   1. Put the values in ~/mila-paddle-sandbox.env as KEY=VALUE lines, OR pass a path:
 *        node scripts/apply-paddle-sandbox-env.mjs [path/to/file.env]
 *   2. The script validates prefixes, writes Vercel env (values never printed),
 *      updates .env.local, and asks Vercel to redeploy main (VITE_* vars are
 *      build-time, so a redeploy is mandatory for the client token).
 *
 * Never prints secret values; safe to run repeatedly.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const DEFAULT_FILE = join(homedir(), "mila-paddle-sandbox.env");
const file = process.argv[2] ?? DEFAULT_FILE;

if (!existsSync(file)) {
  console.error(`No env file at ${file}.`);
  console.error("Create it with these three lines (values from the sandbox dashboard):");
  console.error("  PADDLE_SANDBOX_API_KEY=pdl_sdbx_apikey_…");
  console.error("  VITE_PADDLE_CLIENT_TOKEN=test_…");
  console.error("  PADDLE_SANDBOX_WEBHOOK_SECRET=…");
  process.exit(1);
}

const wanted = [
  "PADDLE_SANDBOX_API_KEY",
  "VITE_PADDLE_CLIENT_TOKEN",
  "PADDLE_SANDBOX_WEBHOOK_SECRET",
];
const values = {};
for (const line of readFileSync(file, "utf8").split("\n")) {
  const s = line.trim();
  if (!s || s.startsWith("#") || !s.includes("=")) continue;
  const [k, ...rest] = s.split("=");
  const key = k.trim();
  if (wanted.includes(key))
    values[key] = rest
      .join("=")
      .trim()
      .replace(/^["']|["']$/g, "");
}

const problems = [];
if (!values.PADDLE_SANDBOX_API_KEY?.startsWith("pdl_sdbx_apikey_"))
  problems.push("PADDLE_SANDBOX_API_KEY must start with pdl_sdbx_apikey_");
if (!values.VITE_PADDLE_CLIENT_TOKEN?.startsWith("test_"))
  problems.push("VITE_PADDLE_CLIENT_TOKEN must start with test_");
if (!values.PADDLE_SANDBOX_WEBHOOK_SECRET || values.PADDLE_SANDBOX_WEBHOOK_SECRET.length < 20)
  problems.push("PADDLE_SANDBOX_WEBHOOK_SECRET looks too short");
if (problems.length) {
  console.error("Value problems:");
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}

for (const key of wanted) {
  for (const env of ["production", "preview"]) {
    // vercel env add reads the value from stdin; --force replaces an existing entry.
    execFileSync("npx", ["vercel", "env", "add", key, env, "--force"], {
      cwd: REPO,
      input: values[key] + "\n",
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`set ${key} [${env}] (len=${values[key].length})`);
  }
}

// Keep the local dev env in sync (token line only; the API key is server-side).
const localPath = join(REPO, ".env.local");
if (existsSync(localPath)) {
  let text = readFileSync(localPath, "utf8");
  const set = (name, value) => {
    const re = new RegExp(`^${name}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${name}=${value}`) : text + `\n${name}=${value}\n`;
  };
  set("VITE_PADDLE_CLIENT_TOKEN", values.VITE_PADDLE_CLIENT_TOKEN);
  set("VITE_PADDLE_ENV", "sandbox");
  writeFileSync(localPath, text);
  console.log("updated .env.local (VITE_PADDLE_CLIENT_TOKEN, VITE_PADDLE_ENV=sandbox)");
}

console.log("\nDone. VITE_* vars are build-time — redeploying production now is REQUIRED.");
console.log(
  "Trigger it with:  git commit --allow-empty -m 'chore: rebuild with paddle env' && git push",
);
