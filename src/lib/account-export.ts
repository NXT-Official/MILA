/** What a PostgREST read resolves to: `{ data, error }`, never a throw. */
export interface QueryOutcome {
  data: unknown;
  error: { code?: string | null; message?: string } | null;
}

export interface ExportQuery extends PromiseLike<QueryOutcome> {
  maybeSingle(): PromiseLike<QueryOutcome>;
}

/**
 * The slice of the Supabase client the export needs. It is structural rather
 * than the generated `Database` type because `saved_products` ships in a
 * migration that may not be applied yet (and is absent from generated types
 * until they are regenerated); the export must still work without it.
 */
export interface ExportClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): ExportQuery;
    };
  };
}

export interface ExportAccount {
  id: string;
  email: string | undefined;
}

export type ExportTable = "profiles" | "outfits" | "posts" | "user_favorites" | "saved_products";

/** What went wrong reading one table. Never carries row data. */
export interface ExportFailure {
  table: ExportTable;
  code?: string | null;
  message?: string;
}

export type AccountExportResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; message: string; failures: ExportFailure[] };

// How each table reads in a sentence, in the order the file lists them.
const TABLE_LABELS: Record<ExportTable, string> = {
  profiles: "profile",
  outfits: "looks",
  posts: "posts",
  user_favorites: "favorites",
  saved_products: "saved pieces",
};

const GENERIC_FAILURE = "We couldn't prepare your data export. Please try again.";

function failureMessage(failures: ExportFailure[]): string {
  if (failures.length === 0) return GENERIC_FAILURE;
  const labels = failures.map((f) => TABLE_LABELS[f.table]);
  const named =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `We couldn't include your ${named}. Try again in a moment.`;
}

// src: https://postgrest.org/en/stable/references/errors.html (PGRST205: table not in schema cache) · PostgREST 12+
// src: https://www.postgresql.org/docs/current/errcodes-appendix.html (42P01: undefined_table)
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

export function isMissingTableError(error: { code?: string | null } | null | undefined): boolean {
  return !!error?.code && MISSING_TABLE_CODES.has(error.code);
}

export function buildAccountExport(input: {
  exportedAt: string;
  account: ExportAccount;
  profile: QueryOutcome;
  outfits: QueryOutcome;
  posts: QueryOutcome;
  favorites: QueryOutcome;
  savedProducts: QueryOutcome;
}): AccountExportResult {
  const { profile, outfits, posts, favorites, savedProducts } = input;

  // A data export that quietly leaves rows out is worse than no export: she
  // would believe she holds everything. Any failed read fails the whole thing,
  // and says which part so she knows what to retry.
  // Saved pieces are the one optional section: until their migration is
  // applied the table does not exist, and that is not an error for her.
  const savedMissing = isMissingTableError(savedProducts.error);
  const reads: Array<[ExportTable, QueryOutcome]> = [
    ["profiles", profile],
    ["outfits", outfits],
    ["posts", posts],
    ["user_favorites", favorites],
    ["saved_products", savedMissing ? { data: null, error: null } : savedProducts],
  ];
  const failures: ExportFailure[] = reads.flatMap(([table, outcome]) =>
    outcome.error ? [{ table, code: outcome.error.code, message: outcome.error.message }] : [],
  );
  if (failures.length > 0) return { ok: false, message: failureMessage(failures), failures };

  const list = (outcome: QueryOutcome) => (Array.isArray(outcome.data) ? outcome.data : []);

  return {
    ok: true,
    payload: {
      exportedAt: input.exportedAt,
      account: { id: input.account.id, email: input.account.email },
      profile: profile.data ?? null,
      outfits: list(outfits),
      posts: list(posts),
      favorites: list(favorites),
      ...(savedMissing ? {} : { savedProducts: list(savedProducts) }),
    },
  };
}

export async function fetchAccountExport(
  account: ExportAccount,
  client: ExportClient,
  exportedAt: string = new Date().toISOString(),
): Promise<AccountExportResult> {
  try {
    const [profile, outfits, posts, favorites, savedProducts] = await Promise.all([
      client.from("profiles").select("*").eq("id", account.id).maybeSingle(),
      client.from("outfits").select("*").eq("user_id", account.id),
      client.from("posts").select("*").eq("user_id", account.id),
      client.from("user_favorites").select("*").eq("user_id", account.id),
      client.from("saved_products").select("*").eq("user_id", account.id),
    ]);
    const result = buildAccountExport({
      exportedAt,
      account,
      profile,
      outfits,
      posts,
      favorites,
      savedProducts,
    });
    if (!result.ok) {
      // The table and the database's own code and message, so a failed export
      // can be diagnosed. Never the rows, and never what she would see.
      for (const { table, code, message } of result.failures) {
        console.error(`[account-export] ${table} read failed`, { code, message });
      }
    }
    return result;
  } catch (cause) {
    console.error(
      "[account-export] request failed",
      cause instanceof Error ? cause.message : String(cause),
    );
    return { ok: false, message: GENERIC_FAILURE, failures: [] };
  }
}
