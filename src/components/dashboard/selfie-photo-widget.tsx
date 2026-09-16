import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageIcon, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { CameraCapture } from "@/components/capture/camera-capture";
import {
  saveConsentedProfilePhoto,
  deleteMyProfilePhoto,
  getMyProfilePhotoUrl,
} from "@/lib/profile-photo.functions";
import { queryKeys } from "@/constants/query-keys";
import { errorMessage } from "@/lib/utils";

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read the image file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Lets a user attach a selfie directly from the dashboard so "Create My
 * Look" can composite it onto the generated outfit. This is the same
 * consent used by the onboarding face scan / Style Profile — saving here
 * sets profiles.photo_consent_at + profile_photo_path exactly like those
 * flows, so "Create My Look" picks it up automatically on the next run.
 */
export function SelfiePhotoWidget({
  hasConsent,
  userId,
}: {
  hasConsent: boolean;
  userId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const savePhoto = useServerFn(saveConsentedProfilePhoto);
  const deletePhoto = useServerFn(deleteMyProfilePhoto);
  const fetchPhotoUrl = useServerFn(getMyProfilePhotoUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: photo } = useQuery({
    queryKey: queryKeys.profilePhotoUrl(userId),
    queryFn: () => fetchPhotoUrl(),
    enabled: !!userId && hasConsent,
    staleTime: 60_000,
  });

  async function persist(dataUri: string) {
    setSaving(true);
    try {
      await savePhoto({ data: { imageDataUri: dataUri } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profilePhotoUrl(userId) }),
      ]);
      toast.success("Selfie saved — Create My Look will use it from now on.");
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save that photo. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      await deletePhoto();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profilePhotoUrl(userId) }),
      ]);
      toast.success("Selfie removed — looks will use a generic model instead.");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't remove that photo. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  if (hasConsent && !open) {
    return (
      <div className="flex items-center gap-3 rounded-full border border-border bg-card px-3 py-1.5">
        {photo?.url ? (
          <img src={photo.url} alt="Your selfie" className="size-7 rounded-full object-cover" />
        ) : (
          <CheckCircle2 className="size-4 text-accent" />
        )}
        <span className="text-xs text-muted-foreground">Your selfie is on file</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-accent hover:underline"
        >
          Change
        </button>
        <button
          type="button"
          onClick={handleRemove}
          disabled={saving}
          aria-label="Remove selfie"
          className="text-muted-foreground hover:text-destructive disabled:opacity-50"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-dashed border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-accent hover:text-ink transition-colors"
      >
        <Camera className="size-3.5" />
        Add your selfie — see your own face in every look
      </button>
    );
  }

  return (
    <div className="max-w-sm space-y-3 rounded-card border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ink">Add your selfie</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-muted-foreground hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-micro text-muted-foreground leading-relaxed">
        Private, deletable anytime. Mila composites your outfit onto this exact photo — your face,
        identity, and background are never altered by the generator.
      </p>
      <CameraCapture
        facingMode="user"
        title="Take a selfie"
        subtitle="Face the camera in even light. This photo is used only for your looks."
        analyzing={saving}
        onCapture={async (file) => persist(await fileToDataUri(file))}
        onPickGallery={() => fileRef.current?.click()}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (!file.type.startsWith("image/")) {
            toast.error("Please choose an image file.");
            return;
          }
          await persist(await fileToDataUri(file));
        }}
      />
      <div className="flex items-center justify-center gap-1 text-micro text-muted-foreground">
        <ImageIcon className="size-3" />
        Or drop/choose a photo above
      </div>
    </div>
  );
}
