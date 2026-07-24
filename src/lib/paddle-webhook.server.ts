import { createHmac, timingSafeEqual } from "node:crypto";

function parseSignatureHeader(header: string): { ts?: string; h1?: string } {
  const parsed: Record<string, string> = {};
  for (const segment of header.split(";")) {
    const [key, value] = segment.split("=");
    if (key && value) parsed[key.trim()] = value.trim();
  }
  return parsed;
}

export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const { ts, h1 } = parseSignatureHeader(header);
  if (!ts || !h1) return false;

  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(h1, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
