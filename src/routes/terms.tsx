import { createFileRoute } from "@tanstack/react-router";
import { pageHead, siteFromMatches } from "@/lib/site-seo";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/terms")({
  head: ({ matches }) =>
    pageHead(
      {
        path: "/terms",
        title: "Terms of Service | Mila",
        description:
          "The terms that apply when you use Mila, including accounts, plans and credits.",
      },
      siteFromMatches(matches),
    ),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p className="font-medium text-muted-foreground">
        [TERMS OF SERVICE COPY — PENDING LEGAL REVIEW]
      </p>
      <p>
        This placeholder stands in for Mila&apos;s full Terms of Service while the final copy is
        drafted and reviewed by counsel. Once published, this page will describe the rules for using
        the app, your account responsibilities, subscription and billing terms, acceptable use,
        intellectual property, and how disputes are handled.
      </p>
      <p>
        If you have questions about these terms in the meantime, please reach out through the
        support options available in the app.
      </p>
    </LegalPage>
  );
}
