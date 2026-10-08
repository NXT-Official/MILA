import { createFileRoute } from "@tanstack/react-router";
import { pageHead, siteFromMatches } from "@/lib/site-seo";
import { LegalPage } from "@/components/legal/legal-page";

export const Route = createFileRoute("/privacy")({
  head: ({ matches }) =>
    pageHead(
      {
        path: "/privacy",
        title: "Privacy Policy | Mila",
        description:
          "How Mila collects, uses and protects your personal data, and the choices you have.",
      },
      siteFromMatches(matches),
    ),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p className="font-medium text-muted-foreground">
        [PRIVACY POLICY COPY — PENDING LEGAL REVIEW]
      </p>
      <p>
        This placeholder stands in for Mila&apos;s full Privacy Policy while the final copy is
        drafted and reviewed by counsel. Once published, this page will describe what personal data
        we collect, how we use it, who we share it with, how long we retain it, and the choices and
        rights available to you regarding your data.
      </p>
      <p>
        If you have questions about privacy in the meantime, please reach out through the support
        options available in the app.
      </p>
    </LegalPage>
  );
}
