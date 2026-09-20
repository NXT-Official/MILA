// Shared identity-preservation prompt fragment for every muse-image call that
// takes a real user selfie as input (single-photo outfit edit, multi-view
// style sheet). Extracted so the two prompts can't drift apart — a change to
// what "preserve exactly" means for one flow now automatically applies to
// the other. Text is confirmed-live-effective wording pulled from
// openrouter-photo-edit.server.ts's original buildEditPrompt.
export function buildIdentityLockLine(gender: string | null): string {
  const genderLine =
    gender && gender !== "Prefer not to say"
      ? ` This is a ${gender.toLowerCase()}-presenting person — the edit MUST keep them looking ${gender.toLowerCase()}-presenting; never shift apparent gender, sex characteristics, or facial structure.`
      : "";
  return `Preserve exactly: the person's face, identity, facial structure, eye shape and color, nose, lips, eyebrows, hairline, apparent gender presentation, skin tone and texture, freckles/moles/scars, apparent age, body proportions, pose, hands, and background.${genderLine} Do not beautify, smooth, symmetrize, lighten/darken skin, slim the face or body, reshape, or relight the image — fidelity to the source photo beats aesthetic polish.`;
}
