import { createClient } from "@sanity/client";
import { requireEnv } from "@/lib/env";

const env = requireEnv({
  SANITY_PROJECT_ID: process.env.SANITY_PROJECT_ID,
  SANITY_DATASET: process.env.SANITY_DATASET,
});

export const sanity = createClient({
  projectId: env.SANITY_PROJECT_ID,
  dataset: env.SANITY_DATASET,
  apiVersion: "2026-08-01",
  useCdn: true,
  // Milliseconds a request may spend connecting, and then waiting on a silent
  // socket, before the client gives it up; the library default is 5 minutes.
  // The landing loader aborts its own read at 4s, but a retry the client had
  // already scheduled when that abort landed still goes out and nothing else
  // would cancel it. Matching the loader's deadline never cuts a read short
  // (the loader's timer is armed first) and ends such a retry within seconds.
  // src: https://github.com/sanity-io/client/blob/v7.26.0/src/http/requestOptions.ts · @sanity/client 7.26.0 · 2026-10-05
  timeout: 4_000,
});
