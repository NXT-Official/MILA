/**
 * Transactional email from Mila's noreply address.
 *
 * Sending goes through Resend's HTTP API with `fetch`, so no SDK enters the
 * serverless bundle and the whole mailer is one request. Missing configuration
 * is not an error: a deployment without `RESEND_API_KEY` logs what it would
 * have sent and reports `skipped`, so sign-up, password changes and purchases
 * keep working on a machine that has no mail keys.
 */
export type MailAttachment = {
  filename: string;
  content: Uint8Array;
  contentType?: string;
};

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
};

export type MailResult = { sent: boolean; id?: string; skipped?: string; error?: string };

export type MailerDeps = {
  apiKey?: string | null;
  from?: string | null;
  fetchImpl?: typeof fetch;
  log?: (message: string, detail?: unknown) => void;
};

export const DEFAULT_MAIL_FROM = "Mila <noreply@mila.app>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function mailerFrom(env: Record<string, string | undefined> = process.env): string {
  const configured = (env.MAIL_FROM ?? "").trim();
  return configured || DEFAULT_MAIL_FROM;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function createMailer(deps: MailerDeps = {}) {
  const log = deps.log ?? ((message, detail) => console.warn(message, detail ?? ""));
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    async send(message: MailMessage): Promise<MailResult> {
      const apiKey = (deps.apiKey ?? process.env.RESEND_API_KEY ?? "").trim();
      const from = (deps.from ?? mailerFrom()).trim();

      if (!apiKey) {
        // Dry run: the caller's flow must not depend on mail being configured.
        log("[mailer] RESEND_API_KEY is not set — email not sent", {
          to: message.to,
          subject: message.subject,
        });
        return { sent: false, skipped: "RESEND_API_KEY is not set" };
      }

      try {
        const response = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            attachments: message.attachments?.map((attachment) => ({
              filename: attachment.filename,
              content: toBase64(attachment.content),
              content_type: attachment.contentType ?? "application/pdf",
            })),
          }),
        });

        const payload = (await response.json().catch(() => null)) as {
          id?: string;
          message?: string;
          name?: string;
        } | null;

        if (!response.ok) {
          const detail = payload?.message ?? payload?.name ?? `HTTP ${response.status}`;
          console.error("[mailer] send failed", { to: message.to, detail });
          return { sent: false, error: detail };
        }

        return { sent: true, id: payload?.id };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[mailer] send threw", { to: message.to, detail });
        return { sent: false, error: detail };
      }
    },
  };
}

export type Mailer = ReturnType<typeof createMailer>;

/** The deployment's mailer: keys and sender come from the environment. */
export function mailer(): Mailer {
  return createMailer();
}
