import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CtaButton({ children = "Get your first look" }: { children?: React.ReactNode }) {
  return (
    <Button asChild size="lg" className="rounded-full px-8 text-xs uppercase tracking-[0.2em]">
      <Link to="/login">
        {children} <ArrowRight className="ml-2 size-4 text-accent" aria-hidden="true" />
      </Link>
    </Button>
  );
}
