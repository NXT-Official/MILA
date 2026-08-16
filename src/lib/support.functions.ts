import { createServerFn } from "@tanstack/react-start";
import { SubmitSupportMessageInput, submitSupportMessageService } from "@/server/services/support";

/**
 * The website's entry point into help and feedback. Thin by design — the IP
 * limit, the captcha check, and the privileged insert live in
 * `@/server/services/support`, which `POST /api/v1/support/message` calls too.
 *
 * The service has to sit there rather than here: this file is imported by the
 * login screen's support dialog, and a top-level `.server` import in a
 * client-reachable module is refused by the bundler's import protection.
 */
export const submitSupportMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => SubmitSupportMessageInput.parse(input))
  .handler(({ data }) => submitSupportMessageService(data));
