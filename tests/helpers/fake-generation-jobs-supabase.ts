import type { AuthError, Session } from "@supabase/supabase-js";

/**
 * Test double for the browser Supabase client, limited to what the web
 * generation client touches: `generation_jobs` reads (filtered, ordered,
 * limited, filtered with `eq`, `gte` or `in`, with the explicit `Authorization` header recorded) and the private
 * `generations` bucket (signed URLs only; `list` is recorded and refused, so a
 * test fails loudly if anything ever lists her folder). A read can be made to
 * hang (`setHang`) until its `abortSignal` fires, answering then the way
 * postgrest-js answers an aborted fetch (an error, not a throw), and the
 * session read can be made to hang (`setSessionHang`). Reads can also be held
 * (`holdReads`): each is answered from the rows as they were when it arrived,
 * but only once released, like a server reply still on its way back.
 */
export type FakeJobRow = Record<string, unknown>;

export type FakeError = { code?: string; message: string; statusCode?: string } | null;

export interface FakeJobsRequest {
  table: string;
  select: string;
  filters: Record<string, unknown>;
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
  authorization: string | null;
  signal: AbortSignal | null;
}

export interface FakeStorageCall {
  op: "createSignedUrl" | "list" | "download";
  bucket: string;
  path?: string;
  expiresIn?: number;
}

export function fakeGenerationJobsClient(initial: {
  session: Session | null;
  sessionError?: AuthError | null;
  rows?: FakeJobRow[];
  error?: FakeError;
  signError?: FakeError;
}) {
  const state = {
    session: initial.session,
    sessionError: initial.sessionError ?? null,
    rows: initial.rows ?? [],
    error: initial.error ?? null,
    signError: initial.signError ?? null,
    tables: {} as Record<string, FakeJobRow[]>,
    hang: false,
    sessionHang: false,
    holding: false,
  };
  const heldReplies: Array<() => void> = [];
  const requests: FakeJobsRequest[] = [];
  const storageCalls: FakeStorageCall[] = [];

  function builder(table: string) {
    const request: FakeJobsRequest = {
      table,
      select: "",
      filters: {},
      order: null,
      limit: null,
      authorization: null,
      signal: null,
    };
    const chain = {
      select: (columns: string) => {
        request.select = columns;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        request.filters[column] = value;
        return chain;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        request.order = { column, ascending: options?.ascending ?? true };
        return chain;
      },
      gte: (column: string, value: unknown) => {
        request.filters[`${column}>=`] = value;
        return chain;
      },
      in: (column: string, values: readonly unknown[]) => {
        request.filters[`${column}:in`] = [...values];
        return chain;
      },
      limit: (count: number) => {
        request.limit = count;
        return chain;
      },
      setHeader: (name: string, value: string) => {
        if (name.toLowerCase() === "authorization") request.authorization = value;
        return chain;
      },
      abortSignal: (signal: AbortSignal) => {
        request.signal = signal;
        return chain;
      },
      then: <T>(resolve: (value: unknown) => T, reject?: (reason: unknown) => T) => {
        requests.push(request);
        if (state.hang) {
          // Never answers; an abort is answered as postgrest-js does (an error result).
          return new Promise((settle) => {
            request.signal?.addEventListener("abort", () =>
              settle({
                data: null,
                error: { code: "", message: "AbortError: This operation was aborted" },
              }),
            );
          }).then(resolve, reject);
        }
        if (state.error) {
          return Promise.resolve({ data: null, error: state.error }).then(resolve, reject);
        }
        const source = table === "generation_jobs" ? state.rows : (state.tables[table] ?? []);
        let rows = source.filter((row) =>
          Object.entries(request.filters).every(([column, value]) =>
            column.endsWith(">=")
              ? String(row[column.slice(0, -2)] ?? "") >= String(value)
              : column.endsWith(":in")
                ? (value as unknown[]).includes(row[column.slice(0, -3)])
                : row[column] === value,
          ),
        );
        if (request.order) {
          const { column, ascending } = request.order;
          rows = [...rows].sort((a, b) => {
            const left = String(a[column] ?? "");
            const right = String(b[column] ?? "");
            return ascending ? left.localeCompare(right) : right.localeCompare(left);
          });
        }
        if (request.limit !== null) rows = rows.slice(0, request.limit);
        if (state.holding) {
          const answer = rows;
          return new Promise((settle) => {
            heldReplies.push(() => settle({ data: answer, error: null }));
          }).then(resolve, reject);
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return chain;
  }

  const client = {
    auth: {
      getSession: () =>
        state.sessionHang
          ? new Promise<never>(() => {})
          : Promise.resolve({ data: { session: state.session }, error: state.sessionError }),
    },
    from: (table: string) => builder(table),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, expiresIn: number) => {
          storageCalls.push({ op: "createSignedUrl", bucket, path, expiresIn });
          if (state.signError) return { data: null, error: state.signError };
          return {
            data: { signedUrl: `https://storage.test/sign/${bucket}/${path}?token=t` },
            error: null,
          };
        },
        list: async () => {
          storageCalls.push({ op: "list", bucket });
          throw new Error("a member's generations folder is never listed");
        },
        download: async (path: string) => {
          storageCalls.push({ op: "download", bucket, path });
          throw new Error("images are read through signed URLs");
        },
      }),
    },
  };

  return {
    client,
    requests,
    storageCalls,
    setRows: (rows: FakeJobRow[]) => {
      state.rows = rows;
    },
    /** Rows of another table (e.g. `outfits`), matched on the same filters. */
    setTable: (table: string, rows: FakeJobRow[]) => {
      state.tables[table] = rows;
    },
    setError: (error: FakeError) => {
      state.error = error;
    },
    /** Every read from now on hangs until it is aborted. */
    setHang: (hang: boolean) => {
      state.hang = hang;
    },
    /**
     * From now on each read is answered from the rows as they are when it
     * arrives, but held until the returned release is called.
     */
    holdReads: () => {
      state.holding = true;
      return () => {
        state.holding = false;
        for (const reply of heldReplies.splice(0)) reply();
      };
    },
    /** The session read hangs (a token refresh that never returns). */
    setSessionHang: (hang: boolean) => {
      state.sessionHang = hang;
    },
    setSession: (session: Session | null, error: AuthError | null = null) => {
      state.session = session;
      state.sessionError = error;
    },
  };
}
