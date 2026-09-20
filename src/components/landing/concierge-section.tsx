import { Section, SectionHeading } from "@/components/landing/section";

const EXCHANGE = [
  {
    role: "user" as const,
    text: "What do I pair with this coat for a dinner tonight?",
  },
  {
    role: "assistant" as const,
    text: "Swap the sneakers for your black block heels, and add the gold hoops from your dossier — keeps the silhouette elongated under low light.",
  },
];

export function ConciergeSection() {
  return (
    <Section id="concierge">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <SectionHeading
          kicker="AI Styling Concierge"
          heading="Ask Mila anything, anytime."
          body="Not sure about a pairing? Stuck between two looks? Mila remembers your dossier and every look you've saved — just ask."
        />
        <div className="space-y-3">
          {EXCHANGE.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-4 py-3 text-sm text-surface"
                  : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm text-foreground"
              }
            >
              {m.text}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
