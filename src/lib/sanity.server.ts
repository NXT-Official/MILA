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
});
