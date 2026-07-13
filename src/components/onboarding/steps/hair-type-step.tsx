import { HAIR_TYPE_OPTIONS } from "@/constants/style-profile";
import { SingleSelectStep } from "./single-select-step";
import { useUpdateStyleProfile } from "@/lib/queries/profile-mutations";

export function HairTypeStep({
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
      fieldLabel="Your hair type"
      value={value}
      options={HAIR_TYPE_OPTIONS}
      guidance="This shapes the silhouette of every hair direction Mila composes, from styling to product suggestions."
      requiredMessage="Select a hair type to continue."
      onBack={onBack}
      onSaved={onSaved}
      save={async (hair_type) => {
        await mutation.mutateAsync({ hair_type });
      }}
    />
  );
}
