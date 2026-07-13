export const passwordChecks = [
  { label: "At least 12 characters", test: (p: string) => p.length >= 12 },
  { label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "One digit", test: (p: string) => /[0-9]/.test(p) },
  { label: "One symbol", test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
];
