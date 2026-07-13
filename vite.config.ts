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
export default defineConfig(({ command, mode }) => {
  // Make .env values (SUPABASE_*, AI_*) visible to server-side code in dev.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

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
      // built output is self-contained.
      ...(command === "build" ? [nitro({ noExternals: true })] : []),
      viteReact(),
      mkcert(),
    ],
  };
});
