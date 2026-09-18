import { defineConfig, loadEnv } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import mkcert from "vite-plugin-mkcert";

function buildCsp(supabaseUrl: string | undefined): string {
  // Dev-only allowance so impeccable live mode can load. Guarded by NODE_ENV.
  const live = process.env.NODE_ENV === "development" ? ["http://localhost:8400"] : [];

  let supabaseOrigin = "";
  try {
    supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
  } catch {
    supabaseOrigin = "";
  }

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...live,
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
      "https://cdn.paddle.com",
    ],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "connect-src": [
      "'self'",
      ...live,
      ...(supabaseOrigin ? [supabaseOrigin] : []),
      "https://api.open-meteo.com",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
      "https://*.ingest.sentry.io",
      "https://*.sentry.io",
    ],
    "frame-src": [
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
      "https://buy.paddle.com",
      "https://sandbox-buy.paddle.com",
    ],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
}

export default defineConfig(({ command, mode }) => {
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
              rollupConfig: {
                output: {
                  // @tensorflow/tfjs-core and @vladmandic/face-api (bundled here by
                  // noExternals: true, into their own _libs/*.mjs chunks) contain a
                  // literal Node-environment `require(...)` call for their Node
                  // platform detection. Rollup's ESM output doesn't auto-shim bare
                  // `require` the way Node's own CJS-in-ESM interop does — confirmed
                  // live in prod: "ReferenceError: require is not defined in ES
                  // module scope" thrown from face-match.server.ts's tfjs import
                  // chain. Inject the one Node-native shim these chunks need.
                  banner: (chunk: { fileName: string }) =>
                    /tensorflow|vladmandic/.test(chunk.fileName)
                      ? "import{createRequire as __createRequire}from'node:module';const require=globalThis.require??__createRequire(import.meta.url);"
                      : "",
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
