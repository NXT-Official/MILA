import { FACE_SHAPE_OPTIONS } from "@/constants/style-profile";
import { SingleSelectStep } from "./single-select-step";
import { useUpdateStyleProfile } from "@/lib/queries/profile-mutations";

export function FaceShapeStep({
  value,
  onBack,
  onSaved,
}: {
  value: string | null;
  onBack: () => void;
  onSaved: () => void;
}) {
  const mutation = useUpdateStyleProfile();
  return (
    <SingleSelectStep
      fieldLabel="Your face shape"
      value={value}
      options={FACE_SHAPE_OPTIONS}
      guidance="Pick whichever shape reads closest — Mila uses this to guide hairstyling, eyewear, and framing suggestions. You can always refine it later."
      requiredMessage="Select a face shape to continue."
      onBack={onBack}
      onSaved={onSaved}
      save={async (face_shape) => {
        await mutation.mutateAsync({ face_shape });
      }}
    />
  );
}
