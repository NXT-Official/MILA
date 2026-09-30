import { describe, expect, test } from "bun:test";
import { accountDeletedEmail, passwordChangedEmail, receiptEmail } from "./member-emails";

describe("passwordChangedEmail", () => {
  const email = passwordChangedEmail({
    name: "Nadia",
    changedAt: new Date("2026-09-30T10:15:00Z"),
  });

  test("says what happened, when, and what to do if it wasn't them", () => {
    expect(email.subject).toBe("Your Mila password was changed");
    expect(email.html).toContain("Nadia");
    expect(email.html).toContain("2026-09-30 10:15");
    expect(email.html).toContain("help desk");
    expect(email.text).toContain("Nadia");
    expect(email.text).not.toContain("<p");
  });

  test("works for a member with no name on file", () => {
    const anonymous = passwordChangedEmail({ name: null, changedAt: new Date() });
    expect(anonymous.html).toContain("Hi there");
  });
});

describe("accountDeletedEmail", () => {
  const email = accountDeletedEmail({ name: "Nadia", deletedAt: new Date("2026-09-30T11:00:00Z") });

  test("confirms the deletion and the cancelled billing", () => {
    expect(email.subject).toBe("Your Mila account has been deleted");
    expect(email.html).toContain("2026-09-30 11:00");
    expect(email.html).toContain("Paddle");
    expect(email.text).toContain("deleted");
  });
});

describe("receiptEmail", () => {
  const email = receiptEmail({
    name: "Nadia",
    planTitle: "Style Pro",
    amount: "$49.99",
    paidOn: "30 Sep 2026",
    periodEnd: "30 Oct 2026",
    receiptNumber: "MILA-2026-6W8A0E",
    transactionId: "txn_01kztk3s79phsrq1e8b76w8a0e",
  });

  test("carries the amount, the plan, the period and the receipt number", () => {
    expect(email.subject).toBe("Your Mila receipt MILA-2026-6W8A0E");
    expect(email.html).toContain("$49.99");
    expect(email.html).toContain("Style Pro");
    expect(email.html).toContain("30 Oct 2026");
    expect(email.html).toContain("attached as a PDF");
    expect(email.text).toContain("MILA-2026-6W8A0E");
    expect(email.text).toContain("txn_01kztk3s79phsrq1e8b76w8a0e");
  });

  test("reads correctly when the period end is unknown", () => {
    const openEnded = receiptEmail({
      name: null,
      planTitle: "Style Pro",
      amount: "$49.99",
      paidOn: "30 Sep 2026",
      periodEnd: null,
      receiptNumber: "MILA-2026-6W8A0E",
      transactionId: "txn_1",
    });
    expect(openEnded.html).toContain("Your receipt is attached as a PDF");
    expect(openEnded.html).not.toContain("active until");
  });
});
