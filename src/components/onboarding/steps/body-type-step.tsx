import { BODY_OPTIONS } from "@/constants/style-profile";
import { SingleSelectStep } from "./single-select-step";
import { useUpdateStyleProfile } from "@/lib/queries/profile-mutations";

export function BodyTypeStep({
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
      fieldLabel="Your silhouette"
      value={value}
      options={BODY_OPTIONS}
      guidance="Choose the shape that most closely describes how your shoulders, waist, and hips relate to one another. This drives every cut, drape, and proportion recommendation — there's no wrong answer."
      requiredMessage="Select a body silhouette to continue."
      onBack={onBack}
      onSaved={onSaved}
      save={async (body_type) => {
        await mutation.mutateAsync({ body_type });
      }}
    />
  );
}
