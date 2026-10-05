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
  // One retry, not the library's five: a read against a failing Sanity was up
  // to six requests. The landing loader does the backing off, serving what it
  // has and leaving Sanity alone for 30s after a failed read.
  // src: https://github.com/sanity-io/client/blob/v7.26.0/src/types.ts · @sanity/client 7.26.0 · 2026-10-05
  maxRetries: 1,
  // Milliseconds a request may spend connecting, and then waiting on a silent
  // socket, before the client gives it up; the library default is 5 minutes.
  // The landing loader aborts its own read at 4s, and that abort also cancels
  // a retry the client has scheduled but not yet sent: on abort, get-it stops
  // listening for the retry. This limit is for a request made without a signal;
  // it never cuts the loader's read short (the loader's timer is armed first).
  // src: https://github.com/sanity-io/client/blob/v7.26.0/src/http/requestOptions.ts · @sanity/client 7.26.0 · 2026-10-05
  // src: https://github.com/sanity-io/get-it/blob/v8.8.1/src/createRequester.ts · get-it 8.8.1 · 2026-10-05
  timeout: 4_000,
});
