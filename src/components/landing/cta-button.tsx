import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CtaButton({ className }: { className?: string }) {
  return (
    <Button asChild size="pill-lg" className={cn(className)}>
      <Link to="/login">
        Get your first look
        <ArrowRight className="ml-2 size-4 text-accent" aria-hidden="true" />
      </Link>
    </Button>
  );
}
