export interface OutOfCreditsCopy {
  title: string;
  description: string;
}

/**
 * What the out-of-credits dialog says. A member on a plan has spent today's
 * allowance; a member with no plan never had one, so "used up" would be wrong —
 * they are told styling is part of a membership instead.
 */
export function outOfCreditsCopy(input: { hasPlan: boolean }): OutOfCreditsCopy {
  if (input.hasPlan) {
    return {
      title: "Studio Energy Depleted",
      description:
        "You've used today's styling credits. Move to a membership with a bigger daily allowance.",
    };
  }
  return {
    title: "Styling is part of a membership",
    description:
      "Mila's AI styling comes with a membership. Pick a plan and your styling credits refresh every day.",
  };
}
