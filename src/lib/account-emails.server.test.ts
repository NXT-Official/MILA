import { describe, expect, mock, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendAccountDeletedEmail, sendPasswordChangedEmail } from "./account-emails.server";
import type { MailMessage } from "./mailer.server";

function fakeDb(config: { email?: string | null; profile?: { full_name?: string } | null } = {}) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: config.profile ?? null, error: null }),
  };
  return {
    from: () => chain,
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user:
              config.email === undefined ? { email: "nadia@example.com" } : { email: config.email },
          },
          error: null,
        }),
      },
    },
  } as unknown as SupabaseClient<Database>;
}

function fakeMailer(result: { sent: boolean; skipped?: string; error?: string } = { sent: true }) {
  return { send: mock(async (_message: MailMessage) => result) };
}

describe("sendPasswordChangedEmail", () => {
  test("emails the member by name from the noreply address", async () => {
    const mail = fakeMailer();
    const outcome = await sendPasswordChangedEmail("user-1", {
      db: fakeDb({ profile: { full_name: "Nadia Haddad" } }),
      mail: mail as never,
      now: () => new Date("2026-09-30T10:00:00Z"),
    });

    expect(outcome).toEqual({ sent: true });
    const message = mail.send.mock.calls[0][0];
    expect(message.to).toBe("nadia@example.com");
    expect(message.subject).toContain("password");
    expect(message.html).toContain("Nadia Haddad");
    expect(message.text.length).toBeGreaterThan(0);
  });

  test("reports a missing address instead of throwing", async () => {
    const mail = fakeMailer();
    const outcome = await sendPasswordChangedEmail("user-1", {
      db: fakeDb({ email: null }),
      mail: mail as never,
    });

    expect(outcome).toEqual({ sent: false, error: "member has no email address" });
    expect(mail.send).not.toHaveBeenCalled();
  });

  test("swallows a mailer crash — the password is already changed", async () => {
    const mail = {
      send: mock(async () => {
        throw new Error("resend unreachable");
      }),
    };
    const outcome = await sendPasswordChangedEmail("user-1", {
      db: fakeDb(),
      mail: mail as never,
    });

    expect(outcome).toEqual({ sent: false, error: "resend unreachable" });
  });
});

describe("sendAccountDeletedEmail", () => {
  test("writes to the address that was captured before the delete", async () => {
    const mail = fakeMailer();
    const outcome = await sendAccountDeletedEmail(
      { email: "gone@example.com", name: "Nadia Haddad" },
      { mail: mail as never, now: () => new Date("2026-09-30T10:00:00Z") },
    );

    expect(outcome).toEqual({ sent: true });
    expect(mail.send.mock.calls[0][0].to).toBe("gone@example.com");
    expect(mail.send.mock.calls[0][0].text).toContain("Nadia Haddad");
  });

  test("survives a mailer that is not configured", async () => {
    const mail = fakeMailer({ sent: false, skipped: "RESEND_API_KEY not set" });
    const outcome = await sendAccountDeletedEmail(
      { email: "gone@example.com" },
      { mail: mail as never },
    );

    expect(outcome.sent).toBe(false);
    expect(outcome.error).toBe("RESEND_API_KEY not set");
  });
});
