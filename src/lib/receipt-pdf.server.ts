/**
 * Mila receipts, built without a PDF library.
 *
 * A receipt is one page of Helvetica text and a couple of rules, so it is
 * cheaper to write the ~40 lines of PDF the format actually needs than to add a
 * dependency to a serverless bundle. The file is assembled as bytes (offsets in
 * the xref table are byte offsets, not character offsets), every string is
 * sanitised to WinAnsi, and the tests parse the result back to prove the
 * structure is intact.
 */

const encoder = new TextEncoder();

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const RIGHT = PAGE_WIDTH - MARGIN;

export type ReceiptInput = {
  receiptNumber: string;
  issuedAt: Date;
  memberName: string;
  memberEmail: string;
  planTitle: string;
  amountCents: number;
  currency: string;
  paidAt: Date;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  transactionId: string;
  invoiceNumber?: string | null;
  billingInterval?: string | null;
};

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

/** `1999` + `USD` -> `$19.99`; other currencies keep their code (`19.99 SEK`). */
export function formatMoney(amountCents: number, currency: string): string {
  const code = currency.toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code];
  const amount = (amountCents / 100).toFixed(2);
  return symbol ? `${symbol}${amount}` : `${amount} ${code}`;
}

export function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * WinAnsiEncoding is close to Latin-1 with a handful of substitutions in
 * 0x80-0x9F. Characters outside it (CJK, emoji) are dropped to `?` rather than
 * written as bytes the font has no glyph for.
 */
export function sanitizeForPdf(text: string): string {
  const replacements: Record<string, string> = {
    "€": "\u0080",
    "‚": "\u0082",
    "„": "\u0084",
    "…": "\u0085",
    "†": "\u0086",
    "‡": "\u0087",
    "‘": "\u0091",
    "’": "\u0092",
    "“": "\u0093",
    "”": "\u0094",
    "•": "\u0095",
    "–": "\u0096",
    "—": "\u0097",
  };
  let out = "";
  for (const char of text) {
    const replaced = replacements[char];
    if (replaced) {
      out += replaced;
    } else if (char.codePointAt(0)! <= 0xff) {
      out += char;
    } else {
      out += "?";
    }
  }
  return out;
}

function escapeText(text: string): string {
  return sanitizeForPdf(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Helvetica is proportional, so right-aligning an amount needs a width. The
 * standard font metrics are not bundled here; this groups characters by their
 * width class in Helvetica, which is accurate enough to line a column of
 * amounts up (a few tenths of a point of jitter at 10pt).
 */
const NARROW = new Set(" .,:;!|'`ijltfrI()[]".split(""));
const WIDE = new Set("mwMW@".split(""));

export function estimateTextWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const char of sanitizeForPdf(text)) {
    if (NARROW.has(char)) units += 0.3;
    else if (WIDE.has(char)) units += 0.85;
    else if (char >= "A" && char <= "Z") units += bold ? 0.74 : 0.7;
    else units += bold ? 0.58 : 0.55;
  }
  return units * size;
}

type Op = string;

function text(x: number, y: number, value: string, size: number, font: "F1" | "F2" = "F1"): Op {
  return `BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapeText(value)}) Tj ET`;
}

function textRight(
  xRight: number,
  y: number,
  value: string,
  size: number,
  font: "F1" | "F2" = "F1",
): Op {
  const x = xRight - estimateTextWidth(value, size, font === "F2");
  return text(x, y, value, size, font);
}

function rule(y: number, weight = 0.7, gray = 0.82): Op {
  return `${weight} w ${gray} ${gray} ${gray} RG ${MARGIN} ${y} m ${RIGHT} ${y} l S`;
}

function buildContent(input: ReceiptInput): string {
  const ops: Op[] = [];
  const period =
    input.periodStart && input.periodEnd
      ? `${formatDay(input.periodStart)} - ${formatDay(input.periodEnd)}`
      : input.periodEnd
        ? `Until ${formatDay(input.periodEnd)}`
        : "No end date";

  // Header
  ops.push("0.09 0.09 0.09 rg");
  ops.push(text(MARGIN, 772, "MILA", 24, "F2"));
  ops.push(text(MARGIN, 752, "The Mila atelier", 9, "F1"));
  ops.push(textRight(RIGHT, 772, "RECEIPT", 13, "F2"));
  ops.push(textRight(RIGHT, 756, input.receiptNumber, 9));
  ops.push(textRight(RIGHT, 744, `Issued ${formatDay(input.issuedAt)}`, 9));
  ops.push(rule(726, 1, 0.1));

  // Billed to
  ops.push(text(MARGIN, 700, "BILLED TO", 8, "F2"));
  ops.push(text(MARGIN, 684, input.memberName, 11, "F2"));
  ops.push(text(MARGIN, 670, input.memberEmail, 9));

  // Line item table
  ops.push(rule(644));
  ops.push(text(MARGIN, 626, "DESCRIPTION", 8, "F2"));
  ops.push(textRight(RIGHT, 626, "AMOUNT", 8, "F2"));
  ops.push(rule(618));
  ops.push(text(MARGIN, 596, `${input.planTitle} membership`, 10));
  ops.push(text(MARGIN, 582, `Billing period: ${period}`, 8));
  if (input.billingInterval) {
    ops.push(text(MARGIN, 568, `Renews ${input.billingInterval}`, 8));
  }
  ops.push(textRight(RIGHT, 596, formatMoney(input.amountCents, input.currency), 10));

  ops.push(rule(548));
  ops.push(text(MARGIN, 528, "Total paid", 11, "F2"));
  ops.push(textRight(RIGHT, 528, formatMoney(input.amountCents, input.currency), 11, "F2"));
  ops.push(rule(514, 1, 0.1));

  // Payment details
  ops.push(text(MARGIN, 488, "PAYMENT", 8, "F2"));
  ops.push(text(MARGIN, 472, `Collected by Paddle on ${formatDay(input.paidAt)}`, 9));
  ops.push(text(MARGIN, 458, `Transaction ${input.transactionId}`, 8));
  if (input.invoiceNumber) {
    ops.push(text(MARGIN, 446, `Paddle invoice ${input.invoiceNumber}`, 8));
  }

  ops.push(rule(410));
  ops.push(
    text(MARGIN, 392, "This receipt confirms a payment collected by Paddle on Mila's behalf.", 8),
  );
  ops.push(
    text(MARGIN, 380, "Paddle's own invoice is available from your Paddle receipt email.", 8),
  );
  ops.push(text(MARGIN, 368, "Questions? Contact the Mila team from the help desk in the app.", 8));
  ops.push(text(MARGIN, 64, "Mila - mila.app", 8));

  return ops.join("\n");
}

type PdfObject = { id: number; body: Uint8Array };

function object(id: number, body: string): PdfObject {
  return { id, body: encoder.encode(`${id} 0 obj\n${body}\nendobj\n`) };
}

/**
 * One page, six objects, a correct xref table. Returns the raw file bytes —
 * callers store or attach them, they are never re-encoded as a string.
 */
export function buildReceiptPdf(input: ReceiptInput): Uint8Array {
  const content = buildContent(input);
  const contentBytes = encoder.encode(content);

  const objects: PdfObject[] = [
    object(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    object(
      3,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    ),
    object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    object(
      5,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ),
    {
      id: 6,
      body: (() => {
        const head = encoder.encode(`6 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
        const tail = encoder.encode("\nendstream\nendobj\n");
        const merged = new Uint8Array(head.length + contentBytes.length + tail.length);
        merged.set(head, 0);
        merged.set(contentBytes, head.length);
        merged.set(tail, head.length + contentBytes.length);
        return merged;
      })(),
    },
  ];

  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n")];
  let offset = chunks[0].length;
  const offsets = new Map<number, number>();
  for (const obj of objects) {
    offsets.set(obj.id, offset);
    chunks.push(obj.body);
    offset += obj.body.length;
  }

  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const obj of objects) {
    xref += `${String(offsets.get(obj.id) ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(encoder.encode(xref));

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const file = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    file.set(chunk, cursor);
    cursor += chunk.length;
  }
  return file;
}

/** `MILA-2026-0001` style numbers, derived from the Paddle transaction id. */
export function receiptNumber(transactionId: string, issuedAt: Date): string {
  const tail =
    transactionId
      .replace(/[^a-z0-9]/gi, "")
      .slice(-6)
      .toUpperCase() || "000000";
  return `MILA-${issuedAt.getUTCFullYear()}-${tail}`;
}
