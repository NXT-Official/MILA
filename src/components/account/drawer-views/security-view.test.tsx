import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SecurityView } from "./security-view";

type Props = Parameters<typeof SecurityView>[0];

function renderView(overrides: Partial<Props> = {}) {
  const props: Props = {
    authUserEmail: "jane.doe@example.com",
    newEmail: "",
    onNewEmailChange: () => {},
    emailSubmitting: false,
    onChangeEmail: () => {},
    hasPassword: true,
    signInProviders: [],
    currentPassword: "",
    onCurrentPasswordChange: () => {},
    newPassword: "",
    onNewPasswordChange: () => {},
    confirmPassword: "",
    onConfirmPasswordChange: () => {},
    newPasswordOk: false,
    passwordSubmitting: false,
    onChangePassword: () => {},
    captchaField: null,
    captchaReady: false,
    deleteEmail: "",
    onDeleteEmailChange: () => {},
    deleteEmailMatches: false,
    deleting: false,
    onDeleteAccount: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(<SecurityView {...props} />);
}

describe("SecurityView password section", () => {
  test("a member with a password sees the change-password form", () => {
    const out = renderView({ hasPassword: true });
    expect(out).toContain("Change password");
    expect(out).toContain("Current password");
    expect(out).toContain("Update Password");
    expect(out).not.toContain("You sign in with");
  });

  test("a Google-only member keeps the password section, with the explanation in place of the form", () => {
    const out = renderView({ hasPassword: false, signInProviders: ["Google"] });
    // the section is still there under its own heading...
    expect(out).toContain("Change password");
    expect(out).toContain("You sign in with Google");
    // ...but no password field or submit is offered
    expect(out).not.toContain("Current password");
    expect(out).not.toContain("Update Password");
    expect(out).not.toContain('type="password"');
  });

  test("the Google-only note explains there is nothing to change, with no dashes", () => {
    const out = renderView({ hasPassword: false, signInProviders: ["Google"] });
    expect(out).toMatch(/no password to change|nothing to change/i);
    expect(out).not.toMatch(/[–—]/);
  });

  test("names several providers plainly", () => {
    const out = renderView({ hasPassword: false, signInProviders: ["Google", "Apple"] });
    expect(out).toContain("You sign in with Google and Apple");
  });

  test("falls back to a neutral phrase when no provider name is known", () => {
    const out = renderView({ hasPassword: false, signInProviders: [] });
    expect(out).toContain("You sign in with a linked account");
  });

  test("email change and account deletion stay available to a Google-only member", () => {
    const out = renderView({ hasPassword: false, signInProviders: ["Google"] });
    expect(out).toContain("Update Email");
    expect(out).toContain("Delete My Account");
  });
});
