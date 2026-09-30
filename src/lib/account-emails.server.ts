import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { accountDeletedEmail, passwordChangedEmail } from "./member-emails";
import { mailer as defaultMailer, type Mailer } from "./mailer.server";

type MilaSupabaseClient = SupabaseClient<Database>;

export type AccountEmailDeps = {
  db: MilaSupabaseClient;
  mail?: Mailer;
  now?: () => Date;
};

async function loadMember(
  db: MilaSupabaseClient,
  userId: string,
): Promise<{ name: string | null; email: string | null }> {
  const [{ data: profile }, userResult] = await Promise.all([
    db.from("profiles").select("full_name,username").eq("id", userId).maybeSingle(),
    db.auth.admin.getUserById(userId),
  ]);
  return {
    name: profile?.full_name ?? profile?.username ?? null,
    email: userResult.data.user?.email ?? null,
  };
}

/**
 * Tells the member their password changed. Best effort by design: the password
 * has already changed, so a mail failure must never turn that into an error the
 * member sees — it is logged and reported instead.
 */
export async function sendPasswordChangedEmail(
  userId: string,
  deps: AccountEmailDeps,
): Promise<{ sent: boolean; error?: string }> {
  const mail = deps.mail ?? defaultMailer();
  try {
    const member = await loadMember(deps.db, userId);
    if (!member.email) return { sent: false, error: "member has no email address" };
    const content = passwordChangedEmail({
      name: member.name,
      changedAt: (deps.now ?? (() => new Date()))(),
    });
    const result = await mail.send({ to: member.email, ...content });
    return result.sent ? { sent: true } : { sent: false, error: result.error ?? result.skipped };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[account-emails] password-changed notice failed", detail);
    return { sent: false, error: detail };
  }
}

/**
 * The account is already gone by the time this runs, so the address and name
 * are passed in rather than looked up.
 */
export async function sendAccountDeletedEmail(
  input: { email: string; name?: string | null },
  deps: { mail?: Mailer; now?: () => Date } = {},
): Promise<{ sent: boolean; error?: string }> {
  const mail = deps.mail ?? defaultMailer();
  try {
    const content = accountDeletedEmail({
      name: input.name ?? null,
      deletedAt: (deps.now ?? (() => new Date()))(),
    });
    const result = await mail.send({ to: input.email, ...content });
    return result.sent ? { sent: true } : { sent: false, error: result.error ?? result.skipped };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[account-emails] account-deleted notice failed", detail);
    return { sent: false, error: detail };
  }
}
