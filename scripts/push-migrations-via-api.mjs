#!/usr/bin/env bun
/**
 * Applies pending migrations to the linked remote project through the Supabase
 * **Management API** instead of `supabase db push`.
 *
 * Why this exists: `supabase db push` needs a CLI login that is a member of the
 * project's organisation *and* the remote Postgres password (it connects to the
 * database directly — there is no psql/pg client on the machine this was written
 * on). This script needs exactly one credential: a Personal Access Token from an
 * account that can reach the project.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... bun scripts/push-migrations-via-api.mjs
 *   SUPABASE_ACCESS_TOKEN=sbp_... bun scripts/push-migrations-via-api.mjs --versions 20260929043000
 *   bun scripts/push-migrations-via-api.mjs --dry-run          # plan only, no token needed
 *
 * Token lookup order: $SUPABASE_ACCESS_TOKEN, then SUPABASE_ACCESS_TOKEN= in
 * .env.local. The token is never printed.
 *
 * Run order matches `bun run typecheck` expectations: applying a migration also
 * records it in supabase_migrations.schema_migrations, so a later `supabase db
 * push` sees it as applied rather than replaying it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_REF = "umjltztnniycvnsbxrmv";
const API = "https://api.supabase.com/v1";
// fileURLToPath, not .pathname: the repository path contains a space, which
// .pathname would leave percent-encoded.
const MIGRATIONS_DIR = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const ENV_LOCAL = fileURLToPath(new URL("../.env.local", import.meta.url));

// The migration this repository added for the admin console's model switching
// and revenue tax. Pass --versions to target others.
const DEFAULT_TARGETS = ["20260929043000"];

function readEnvLocalToken() {
  try {
    const match = readFileSync(ENV_LOCAL, "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { dryRun: argv.includes("--dry-run"), versions: DEFAULT_TARGETS };
  const versionsFlag = argv.find((a) => a.startsWith("--versions"));
  if (versionsFlag) {
    const value = versionsFlag.includes("=")
      ? versionsFlag.split("=")[1]
      : argv[argv.indexOf(versionsFlag) + 1];
    args.versions = (value ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return args;
}

function localMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => ({ version: file.slice(0, 14), file }))
    .filter(({ version }) => /^\d{14}$/.test(version));
}

async function runSql(token, query) {
  const response = await fetch(`${API}/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Management API ${response.status}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const args = parseArgs(process.argv.slice(2));
const migrations = localMigrations();
const targets = migrations.filter(({ version }) => args.versions.includes(version));

if (targets.length === 0) {
  console.error(`No local migration matches: ${args.versions.join(", ")}`);
  console.error(`Local versions: ${migrations.map(({ version }) => version).join(", ")}`);
  process.exit(1);
}

if (args.dryRun) {
  console.log("Would apply (in order):");
  for (const { version, file } of targets) console.log(`  ${version}  ${file}`);
  console.log(
    "\nDry run only — nothing was sent. Re-run without --dry-run and with a token to apply.",
  );
  process.exit(0);
}

const token = (process.env.SUPABASE_ACCESS_TOKEN ?? readEnvLocalToken() ?? "").trim();
if (!token) {
  console.error(
    [
      "No Supabase access token available to apply migrations.",
      "",
      "Provide one of:",
      `  * SUPABASE_ACCESS_TOKEN=sbp_... bun scripts/push-migrations-via-api.mjs`,
      `  * SUPABASE_ACCESS_TOKEN=sbp_... in ${ENV_LOCAL}`,
      "",
      "The token must come from an account that can reach project " + PROJECT_REF + ".",
      "Alternatively grant that account access to the project's organisation and use:",
      "  supabase link --project-ref " + PROJECT_REF + " && supabase db push",
    ].join("\n"),
  );
  process.exit(1);
}

const applied = await runSql(
  token,
  "select version from supabase_migrations.schema_migrations order by version",
).catch((error) => {
  console.error(`Couldn't read the remote migration history.\n${error.message}`);
  process.exit(1);
});
// The Management API answers a select with { result: [...] }; a couple of
// deployments answer with the bare array. Accept both.
const appliedRows = Array.isArray(applied) ? applied : (applied?.result ?? []);
const appliedVersions = new Set(appliedRows.map((row) => String(row.version ?? "")));

let appliedCount = 0;
for (const { version, file } of targets) {
  if (appliedVersions.has(version)) {
    console.log(`skip   ${version}  already applied on the remote`);
    continue;
  }

  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const name = file.slice(15).replace(/\.sql$/, "");
  try {
    // The migration itself, then the history row — the same pair `db push` writes,
    // so a future CLI push treats this migration as applied.
    await runSql(token, sql);
    await runSql(
      token,
      `insert into supabase_migrations.schema_migrations (version, name, statements) values
         ('${version}', '${name}', ARRAY[$mila$ ${sql} $mila$])
       on conflict (version) do nothing`,
    );
    appliedCount++;
    console.log(`apply  ${version}  ${file}`);
  } catch (error) {
    console.error(`FAILED ${version}  ${file}\n${error.message}`);
    process.exit(1);
  }
}

console.log(
  appliedCount > 0
    ? `\nApplied ${appliedCount} migration(s) to ${PROJECT_REF}. The member app picks the new model settings up on its next request.`
    : `\nNothing to apply — the remote already has every requested migration.`,
);
