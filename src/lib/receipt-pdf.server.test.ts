import { describe, expect, test } from "bun:test";
import {
  buildReceiptPdf,
  estimateTextWidth,
  formatMoney,
  receiptNumber,
  sanitizeForPdf,
  type ReceiptInput,
} from "./receipt-pdf.server";

const SAMPLE: ReceiptInput = {
  receiptNumber: "MILA-2026-ABC123",
  issuedAt: new Date("2026-09-30T10:00:00Z"),
  memberName: "Nadia Rahman",
  memberEmail: "nadia@example.com",
  planTitle: "Style Pro",
  amountCents: 4999,
  currency: "USD",
  paidAt: new Date("2026-09-30T09:59:00Z"),
  periodStart: new Date("2026-09-30T00:00:00Z"),
  periodEnd: new Date("2026-10-30T00:00:00Z"),
  transactionId: "txn_01kztk3s79phsrq1e8b76w8a0e",
  invoiceNumber: "325-10650",
  billingInterval: "monthly",
};

function asLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

/** Reads the xref table back and checks every offset really points at its object. */
function readXref(text: string): { startxref: number; offsets: number[]; trailer: string } {
  const marker = text.lastIndexOf("startxref");
  const startxref = Number(
    text
      .slice(marker + "startxref".length)
      .trim()
      .split("\n")[0],
  );
  const lines = text.slice(startxref).split("\n");
  // lines[0] = "xref", lines[1] = "0 N", lines[2] = the free entry, then one line per object.
  const offsets: number[] = [];
  for (const line of lines.slice(3)) {
    if (/^\d{10} 00000 n\s*$/.test(line)) offsets.push(Number(line.slice(0, 10)));
    else break;
  }
  return { startxref, offsets, trailer: text.slice(text.lastIndexOf("trailer")) };
}

describe("formatMoney", () => {
  test("uses the currency symbol where there is one", () => {
    expect(formatMoney(4999, "USD")).toBe("$49.99");
    expect(formatMoney(0, "USD")).toBe("$0.00");
    expect(formatMoney(123456, "EUR")).toBe("€1234.56");
  });

  test("keeps the code for currencies without a symbol", () => {
    expect(formatMoney(1999, "SEK")).toBe("19.99 SEK");
  });
});

describe("sanitizeForPdf", () => {
  test("keeps Latin-1 text as-is", () => {
    expect(sanitizeForPdf("Nadia Rahman")).toBe("Nadia Rahman");
    expect(sanitizeForPdf("Zoë Müller")).toBe("Zoë Müller");
  });

  test("maps WinAnsi punctuation and drops what the font cannot draw", () => {
    expect(sanitizeForPdf("€20")).toBe("\u008020");
    expect(sanitizeForPdf("a—b")).toBe("a\u0097b");
    expect(sanitizeForPdf("幸子")).toBe("??");
  });
});

describe("receiptNumber", () => {
  test("is derived from the transaction and the issue year", () => {
    const number = receiptNumber(
      "txn_01kztk3s79phsrq1e8b76w8a0e",
      new Date("2026-09-30T00:00:00Z"),
    );
    expect(number).toBe("MILA-2026-6W8A0E");
    expect(number).toMatch(/^MILA-2026-[A-Z0-9]{6}$/);
  });

  test("survives a transaction id with no usable tail", () => {
    expect(receiptNumber("___", new Date("2026-01-01T00:00:00Z"))).toBe("MILA-2026-000000");
  });
});

describe("estimateTextWidth", () => {
  test("grows with the string and with the size", () => {
    expect(estimateTextWidth("MILA", 10)).toBeLessThan(estimateTextWidth("MILA MILA", 10));
    expect(estimateTextWidth("MILA", 10)).toBeLessThan(estimateTextWidth("MILA", 20));
    expect(estimateTextWidth("MMMM", 10)).toBeGreaterThan(estimateTextWidth("iiii", 10));
  });
});

describe("buildReceiptPdf", () => {
  const text = asLatin1(buildReceiptPdf(SAMPLE));

  test("is a PDF file that ends where it says it does", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });

  test("every xref offset points at its object", () => {
    const { startxref, offsets, trailer } = readXref(text);
    expect(startxref).toBeGreaterThan(0);
    expect(offsets).toHaveLength(6);
    offsets.forEach((offset, index) => {
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
    expect(trailer).toContain("/Size 7");
    expect(trailer).toContain("/Root 1 0 R");
  });

  test("the content stream length matches the bytes between stream and endstream", () => {
    const declared = Number(text.match(/\/Length (\d+) >>\nstream\n/)?.[1] ?? -1);
    const start = text.indexOf("stream\n") + "stream\n".length;
    const end = text.indexOf("\nendstream");
    expect(declared).toBeGreaterThan(0);
    expect(end - start).toBe(declared);
  });

  test("every text operator names a font the page declares", () => {
    // A missing font argument once emitted `/undefined 9 Tf`; renderers fall
    // back silently, so the file has to be checked, not eyeballed.
    const fonts = [...text.matchAll(/\/\w+ \d+ Tf/g)].map((match) => match[0]);
    expect(fonts.length).toBeGreaterThan(10);
    expect(fonts.some((font) => font.startsWith("/undefined"))).toBe(false);
    expect(new Set(fonts.map((font) => font.split(" ")[0]))).toEqual(new Set(["/F1", "/F2"]));
  });

  test("carries the member, the plan, the amount and the payment reference", () => {
    expect(text).toContain("Nadia Rahman");
    expect(text).toContain("nadia@example.com");
    expect(text).toContain("Style Pro membership");
    expect(text).toContain("$49.99");
    expect(text).toContain("txn_01kztk3s79phsrq1e8b76w8a0e");
    expect(text).toContain("325-10650");
    expect(text).toContain("30 Sep 2026");
    expect(text).toContain("MILA-2026-ABC123");
  });

  test("escapes parentheses and backslashes instead of breaking the stream", () => {
    const risky = asLatin1(buildReceiptPdf({ ...SAMPLE, memberName: "Ada (Test) \\ Backslash" }));
    expect(risky).toContain("Ada \\(Test\\) \\\\ Backslash");
    expect(risky.endsWith("%%EOF\n")).toBe(true);
  });

  test("a receipt with no period end still renders", () => {
    const openEnded = asLatin1(
      buildReceiptPdf({ ...SAMPLE, periodStart: null, periodEnd: null, invoiceNumber: null }),
    );
    expect(openEnded).toContain("No end date");
    expect(openEnded).not.toContain("Paddle invoice");
    expect(openEnded.endsWith("%%EOF\n")).toBe(true);
  });
});
