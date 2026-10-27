// Seven Years Care site settings.
// Put the WhatsApp support number in .env.local, e.g.
//   NEXT_PUBLIC_WHATSAPP_NUMBER=919876543210
// (country code + number, no "+" or spaces).

export const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") ?? "";

export function whatsappLink(message = "Hi Seven Years Care, I need help with") {
  if (!WHATSAPP_NUMBER) return null;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export const SERVICE_ISSUE_TYPES = [
  "Not working / no power",
  "Damaged or broken part",
  "Wheel, brake or frame issue",
  "Battery or charging issue",
  "Remote / electronics issue",
  "Assembly or installation help",
  "Other",
];

export const SERVICE_MODES = [
  { value: "store_visit", label: "I will bring it to the store" },
  { value: "home_visit", label: "Request a home visit / pickup" },
];

export const COMPLAINT_CATEGORIES = [
  "Product quality",
  "Billing or invoice",
  "Staff behaviour",
  "Delivery or installation",
  "Warranty or service delay",
  "Other",
];

/** Extended warranty sold per item at the counter. */
export const EXTENDED_WARRANTY = {
  months: 6,
  fee: 1200,
  feeLabel: "₹1,200",
};
