import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PrivacyViewProps {
  exporting: boolean;
  onDownloadData: () => void;
  onNavigateSecurity: () => void;
}

export function PrivacyView({ exporting, onDownloadData, onNavigateSecurity }: PrivacyViewProps) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="atelier-label">Your data</p>
        <p className="text-xs text-stone leading-relaxed">
          Mila stores your style profile, outfit analyses, community posts, and favorites to tailor
          your recommendations. Your data is never sold and is only used within the studio.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={onDownloadData}
          disabled={exporting}
          className="w-full"
        >
          {exporting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" strokeWidth={1.75} />
          )}
          <span>{exporting ? "Preparing export…" : "Download My Data"}</span>
        </Button>
        <p className="text-micro text-stone leading-relaxed">
          Exports your profile, outfits, posts, and favorites as JSON.
        </p>
      </div>

      <div className="pt-4 border-t border-porcelain/30 space-y-3">
        <p className="atelier-label">Account removal</p>
        <p className="text-micro text-stone leading-relaxed">
          You can permanently delete your account and all associated data yourself, under Email
          &amp; Security.
        </p>
        <Button variant="secondary" size="sm" onClick={onNavigateSecurity} className="w-full">
          Go to Email &amp; Security
        </Button>
      </div>
    </div>
  );
}
