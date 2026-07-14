import { defineConfig, loadEnv } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import mkcert from "vite-plugin-mkcert";

// mkcert (dev-only, no-op on `vite build`) serves the dev server over HTTPS with a
// locally-trusted cert covering localhost + this machine's LAN IPs, so getUserMedia
// (camera) works as a secure context from phones on the same network. Run
// `bun run dev` and open https://<your-lan-ip>:8080 from another device.
/**
 * Builds the production CSP from the app's actual resource requirements.
 * See docs/security/SECURITY_AUDIT.md for the per-directive rationale.
 */
function buildCsp(supabaseUrl: string | undefined): string {
  let supabaseOrigin = "";
  try {
    supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
  } catch {
    supabaseOrigin = "";
  }

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-inline' is required here: TanStack Start's default SSR stream
    // handler (@tanstack/react-start's defaultStreamHandler) injects React 19
    // hydration data as inline <script> tags whose content differs per
    // request/page, with no nonce wired through in this framework version
    // (verified in a real browser — a strict script-src without it breaks
    // hydration with "Invariant failed"). See SECURITY_AUDIT.md for the
    // follow-up path (a custom SSR entry threading a per-request nonce) once
    // that's verified safe. All application script is still restricted to
    // 'self' + the hCaptcha origins; only same-origin/known-origin scripts
    // can load, and CSP remains defense-in-depth, not the primary XSS control
    // (React's escaping + no dangerouslySetInnerHTML with user content is).
    "script-src": ["'self'", "'unsafe-inline'", "https://hcaptcha.com", "https://*.hcaptcha.com"],
    // Framer Motion and Radix UI set inline style="" attributes at runtime for
    // animation/positioning; there is no practical nonce/hash for per-frame
    // style mutation, so style-src (unlike script-src) accepts unsafe-inline.
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    // Product/plan/AI-analysis image URLs are admin- or AI-supplied and not
    // limited to one host, so img-src allows any https origin rather than an
    // allowlist; this only affects pixel rendering, not script execution.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "connect-src": [
      "'self'",
      ...(supabaseOrigin ? [supabaseOrigin] : []),
      "https://api.open-meteo.com",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
    ],
    "frame-src": ["https://hcaptcha.com", "https://*.hcaptcha.com"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // Clickjacking protection, kept separate from hCaptcha's own frame-src.
    "frame-ancestors": ["'none'"],
  };

  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
}

export default defineConfig(({ command, mode }) => {
  // Make .env values (SUPABASE_*, AI_*) visible to server-side code in dev.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  const isProd = mode === "production";
  const securityHeaders: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(self), payment=()",
    "Content-Security-Policy": buildCsp(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    ...(isProd
      ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" }
      : {}),
  };

  return {
    server: { host: "::", port: 8080 },
    // Run Lightning CSS in dev too, so dev CSS matches the build pipeline.
    css: { transformer: "lightningcss" as const },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart(),
      // Nitro packages the production server bundle (Node target) on build.
      // noExternals: bundle server deps instead of node_modules tracing, so the
      // built output is self-contained. routeRules attach security headers to
      // every response (pages and server functions alike) at the server
      // boundary; a global no-store default keeps SSR/authenticated payloads
      // out of shared caches, with long-lived caching only for hashed assets.
      ...(command === "build"
        ? [
            nitro({
              noExternals: true,
              routeRules: {
                "/**": { headers: { ...securityHeaders, "Cache-Control": "no-store" } },
                "/assets/**": {
                  headers: { "Cache-Control": "public, max-age=31536000, immutable" },
                },
              },
            }),
          ]
        : []),
      viteReact(),
      mkcert(),
    ],
  };
});
