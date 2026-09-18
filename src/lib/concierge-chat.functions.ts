import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { conciergeChatForUser } from "@/server/services/concierge";

const HistoryMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

export const Input = z.object({
  message: z.string().trim().min(1, "Message is required.").max(2000),
  history: z.array(HistoryMessage).max(12).default([]),
  lookId: z.string().uuid().nullable().optional(),
  imageUrl: z.string().url().max(2048).nullable().optional(),
});
export type ConciergeChatInputData = z.infer<typeof Input>;

export type ConciergeReply = { reply: string };

export const conciergeChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = Input.safeParse(input);
    if (!parsed.success) {
      console.error("[conciergeChat] invalid input", parsed.error.flatten());
      throw new Error("Mila couldn't read that message. Please try again.");
    }
    return parsed.data;
  })
  .handler(async ({ data, context }): Promise<ConciergeReply> =>
    conciergeChatForUser(context.supabase, context.userId, data),
  );
