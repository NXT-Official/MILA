import type { LucideIcon } from "lucide-react";
import { Ellipsis } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CatalogTitleCell({
  title,
  slug,
  archived,
}: {
  title: string;
  slug: string;
  archived: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="font-serif text-sm text-ink truncate">{title}</span>
        {archived && (
          <Badge className="border-stone/40 text-stone text-nano uppercase tracking-label">
            Archived
          </Badge>
        )}
      </div>
      <div className="text-micro uppercase tracking-label text-stone mt-0.5 truncate">{slug}</div>
    </div>
  );
}

export function ToggleCell({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex justify-center">
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function RowActionsMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="size-8 p-0 text-stone hover:text-ink">
            <Ellipsis className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{children}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ActionItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      className={destructive ? "text-destructive focus:text-destructive" : undefined}
    >
      <Icon className="mr-2 size-4" strokeWidth={1.75} aria-hidden="true" />
      {label}
    </DropdownMenuItem>
  );
}
