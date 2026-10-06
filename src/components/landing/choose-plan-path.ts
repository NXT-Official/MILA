/**
 * Where "Choose Plan" leads from the public marketing pages. Kept out of
 * `pricing-section.tsx` so that file exports only its component. Plans are
 * bought inside the studio, so a member goes straight to the plans page; the
 * login page only bounces members to the dashboard.
 */
export function choosePlanPath(signedIn: boolean): "/pricing" | "/login" {
  return signedIn ? "/pricing" : "/login";
}
