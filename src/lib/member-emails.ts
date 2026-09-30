/**
 * The emails Mila sends from its noreply address. Each one returns a subject
 * plus both an HTML and a plain-text body — a member reading mail in a client
 * that blocks HTML still gets the whole message.
 */
export type EmailContent = { subject: string; html: string; text: string };

const BRAND = "Mila";

function layout(input: { heading: string; paragraphs: string[]; footnote?: string }): string {
  const body = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1c1c1c">${paragraph}</p>`,
    )
    .join("");
  const footnote = input.footnote
    ? `<p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#7a7a7a">${input.footnote}</p>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;background:#f6f4f1;padding:28px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px 30px;font-family:Helvetica,Arial,sans-serif">
    <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#7a7a7a">${BRAND}</div>
    <h1 style="margin:10px 0 20px;font-size:21px;line-height:1.3;color:#111">${input.heading}</h1>
    ${body}
    ${footnote}
  </div>
</body></html>`;
}

function paragraphText(paragraphs: string[]): string {
  return paragraphs.join("\n\n");
}

export function passwordChangedEmail(input: {
  name?: string | null;
  changedAt: Date;
}): EmailContent {
  const who = input.name?.trim() ? input.name.trim() : "there";
  const when = input.changedAt.toISOString().replace("T", " ").slice(0, 16);
  const heading = "Your Mila password was changed";
  const paragraphs = [
    `Hi ${who},`,
    `The password on your Mila account was changed on ${when} UTC.`,
    "If that was you, nothing else is needed. If it wasn't, reset your password from the sign-in screen right away and contact the Mila help desk so we can secure the account.",
  ];
  return {
    subject: "Your Mila password was changed",
    html: layout({
      heading,
      paragraphs,
      footnote: "This is an automated message from a no-reply address.",
    }),
    text: `${paragraphText(paragraphs)}\n\nThis is an automated message from a no-reply address.`,
  };
}

export function accountDeletedEmail(input: {
  name?: string | null;
  deletedAt: Date;
}): EmailContent {
  const who = input.name?.trim() ? input.name.trim() : "there";
  const when = input.deletedAt.toISOString().replace("T", " ").slice(0, 16);
  const heading = "Your Mila account has been deleted";
  const paragraphs = [
    `Hi ${who},`,
    `Your Mila account was deleted on ${when} UTC, along with your looks, photos and saved items. Any membership billed through Paddle has been cancelled.`,
    "If you didn't ask for this, contact the Mila help desk and we will look into it. Otherwise, you're welcome back any time.",
  ];
  return {
    subject: "Your Mila account has been deleted",
    html: layout({
      heading,
      paragraphs,
      footnote: "This is an automated message from a no-reply address.",
    }),
    text: `${paragraphText(paragraphs)}\n\nThis is an automated message from a no-reply address.`,
  };
}

export function receiptEmail(input: {
  name?: string | null;
  planTitle: string;
  amount: string;
  paidOn: string;
  periodEnd?: string | null;
  receiptNumber: string;
  transactionId: string;
}): EmailContent {
  const who = input.name?.trim() ? input.name.trim() : "there";
  const heading = "Your Mila receipt";
  const paragraphs = [
    `Hi ${who},`,
    `Thanks for your payment of ${input.amount} for ${input.planTitle}, collected on ${input.paidOn}.`,
    input.periodEnd
      ? `Your membership is active until ${input.periodEnd}. Your receipt is attached as a PDF.`
      : "Your receipt is attached as a PDF.",
    "You can manage or cancel your membership from the account screen in the Mila app.",
  ];
  return {
    subject: `Your Mila receipt ${input.receiptNumber}`,
    html: layout({
      heading,
      paragraphs,
      footnote: `Receipt ${input.receiptNumber} · Paddle transaction ${input.transactionId}. This is an automated message from a no-reply address.`,
    }),
    text: `${paragraphText(paragraphs)}\n\nReceipt ${input.receiptNumber} · Paddle transaction ${input.transactionId}\nThis is an automated message from a no-reply address.`,
  };
}
