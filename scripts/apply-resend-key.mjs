#!/usr/bin/env node
/**
 * apply-resend-key.mjs — point the MILA Supabase project's auth emails at Resend.
 *
 * The password-reset / recovery emails for BOTH clients (web + mobile) are sent
 * by Supabase Auth, so the SMTP credentials live on the Supabase project — not
 * in either repo. This script re-enables the project's custom SMTP with a fresh
 * Resend API key, or falls back to Supabase's built-in mailer.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-resend-key.mjs re_xxxxxxxx
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-resend-key.mjs --disable
 *   node scripts/apply-resend-key.mjs re_xxxxxxxx --dry-run
 *
 * It also writes RESEND_API_KEY into .env.local for the web app's own mailer
 * (src/lib/mailer.server.ts — account emails). Production additionally needs
 * RESEND_API_KEY in the Vercel project env; set it in the Vercel dashboard or
 * hand a logged-in browser session to the agent.
 */

const PROJECT_REF = "umjltztnniycvnsbxrmv";
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;

const SMTP = {
  smtp_host: "smtp.resend.com",
  smtp_port: "465",
  smtp_user: "resend",
  smtp_admin_email: "noreply@naaxtech.com",
  smtp_sender_name: "Naaxtech",
  smtp_max_frequency: 60,
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const disable = args.includes("--disable");
const key = args.find((a) => a.startsWith("re_"));

if (!disable && !key) {
  console.error("Usage: node scripts/apply-resend-key.mjs <re_...key> [--dry-run] | --disable [--dry-run]");
  process.exit(1);
}

const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
if (!token && !dryRun) {
  console.error("SUPABASE_ACCESS_TOKEN is required (a Supabase personal access token).");
  process.exit(1);
}

const mask = (v) => (v ? v.slice(0, 6) + "…" + v.slice(-4) : "");
const body = disable ? { smtp_host: "" } : { ...SMTP, smtp_pass: key };

console.log(disable ? "→ disabling custom SMTP (built-in mailer)" : "→ enabling Resend SMTP");
console.log("   payload:", JSON.stringify(disable ? body : { ...body, smtp_pass: mask(key) }));

if (!dryRun) {
  const res = await fetch(API, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("PATCH failed:", res.status, await res.text());
    process.exit(1);
  }
  const check = await fetch(API, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  console.log("   applied. smtp_host =", JSON.stringify(check.smtp_host), "| pass set:", Boolean(check.smtp_pass));

  if (!disable && key) {
    const fs = await import("node:fs");
    const path = ".env.local";
    if (fs.existsSync(path)) {
      const text = fs.readFileSync(path, "utf8");
      const line = `RESEND_API_KEY=${key}`;
      const next = /^RESEND_API_KEY=.*$/m.test(text)
        ? text.replace(/^RESEND_API_KEY=.*$/m, line)
        : text.replace(/\s*$/, "\n") + line + "\n";
      fs.writeFileSync(path, next);
      console.log("   .env.local: RESEND_API_KEY updated");
    } else {
      console.log("   .env.local not found — skipped (web mailer key)");
    }
  }
} else {
  console.log("   (dry run — nothing sent)");
}

console.log(`
Next:
  1. Verify a reset end-to-end (request from /login/forgot-password; check the inbox).
  2. Production web env: set RESEND_API_KEY in Vercel (Project → Settings → Environment
     Variables), then redeploy (any push to main).${disable ? "\n  3. The built-in mailer is rate-limited and sends from noreply@mail.app.supabase.io — fine for testing, not for launch." : ""}`);
