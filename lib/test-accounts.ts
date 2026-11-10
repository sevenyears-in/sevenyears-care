// Test customer used only by Google Play's app reviewers.
// Anything done from this number is kept quiet: no staff alerts, no WhatsApp / e-mail, never published as a review.
export const TEST_MOBILES = ["9000000001"];

/** True for the reviewer test number (accepts +91 / spaces). */
export function isTestMobile(mobile: unknown): boolean {
  const digits = String(mobile ?? "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 && TEST_MOBILES.includes(digits);
}
