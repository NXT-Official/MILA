import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_MAIL_FROM, createMailer, mailerFrom, type MailMessage } from "./mailer.server";

const MESSAGE: MailMessage = {
  to: "nadia@example.com",
  subject: "Your Mila receipt",
  html: "<p>Thanks</p>",
  text: "Thanks",
};

function okResponse(id = "re_123") {
  return new Response(JSON.stringify({ id }), { status: 200 });
}

describe("mailerFrom", () => {
  test("defaults to the Mila noreply address", () => {
    expect(mailerFrom({})).toBe(DEFAULT_MAIL_FROM);
    expect(DEFAULT_MAIL_FROM).toContain("noreply@");
  });

  test("honours MAIL_FROM when the deployment sets one", () => {
    expect(mailerFrom({ MAIL_FROM: "Mila <hello@mila.test>" })).toBe("Mila <hello@mila.test>");
    expect(mailerFrom({ MAIL_FROM: "   " })).toBe(DEFAULT_MAIL_FROM);
  });
});

describe("createMailer", () => {
  test("without an API key it logs and skips instead of failing the flow", async () => {
    const fetchImpl = mock(async () => okResponse());
    const log = mock(() => {});
    const mail = createMailer({ apiKey: "", fetchImpl: fetchImpl as unknown as typeof fetch, log });

    const result = await mail.send(MESSAGE);

    expect(result).toEqual({ sent: false, skipped: "RESEND_API_KEY is not set" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  test("sends through Resend with the noreply sender and the member as recipient", async () => {
    const fetchImpl = mock(async () => okResponse());
    const mail = createMailer({
      apiKey: "re_test_key",
      from: "Mila <noreply@mila.app>",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });

    const result = await mail.send(MESSAGE);

    expect(result).toEqual({ sent: true, id: "re_123" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("Mila <noreply@mila.app>");
    expect(body.to).toEqual(["nadia@example.com"]);
    expect(body.subject).toBe("Your Mila receipt");
    expect(body.html).toBe("<p>Thanks</p>");
    expect(body.text).toBe("Thanks");
  });

  test("attaches the receipt PDF as base64 with a filename and type", async () => {
    const fetchImpl = mock(async () => okResponse());
    const mail = createMailer({
      apiKey: "re_test_key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

    await mail.send({
      ...MESSAGE,
      attachments: [{ filename: "mila-receipt.pdf", content: pdf }],
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.attachments).toEqual([
      {
        filename: "mila-receipt.pdf",
        content: Buffer.from(pdf).toString("base64"),
        content_type: "application/pdf",
      },
    ]);
  });

  test("a rejected send is reported, never thrown", async () => {
    const fetchImpl = mock(
      async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }),
    );
    const mail = createMailer({
      apiKey: "re_test_key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });

    expect(await mail.send(MESSAGE)).toEqual({ sent: false, error: "domain not verified" });
  });

  test("a network failure is reported, never thrown", async () => {
    const fetchImpl = mock(async () => {
      throw new Error("connection refused");
    });
    const mail = createMailer({
      apiKey: "re_test_key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {},
    });

    expect(await mail.send(MESSAGE)).toEqual({ sent: false, error: "connection refused" });
  });
});
