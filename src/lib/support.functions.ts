import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { submitSupportMessageForIp } from "@/server/services/support";

export const SubmitSupportMessageInput = z.object({
  kind: z.enum(["help", "feedback"]),
  message: z.string().trim().min(1).max(2000),
  captchaToken: z.string().min(1).max(4000),
});
export type SubmitSupportMessageInputData = z.infer<typeof SubmitSupportMessageInput>;

export const submitSupportMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => SubmitSupportMessageInput.parse(input))
  .handler(async ({ data }) => submitSupportMessageForIp(getRequestIP() ?? null, data));
