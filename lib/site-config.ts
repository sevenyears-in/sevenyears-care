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

/** Problems you can see — the customer adds 3 photos (front, side, close-up of the problem). */
export const PHOTO_REQUIRED_ISSUES = ["Damaged or broken part", "Wheel, brake or frame issue"];
/** Problems where photos may help but are optional. */
export const PHOTO_OPTIONAL_ISSUES = ["Battery or charging issue", "Remote / electronics issue", "Assembly or installation help", "Other"];

/** Paid service (bought elsewhere / no Seven Years warranty). */
export const PAID_PRODUCT_TYPES = [
  "Ride-on car / jeep / bike",
  "Bicycle / tricycle",
  "Stroller / pram",
  "Car seat",
  "Cradle / cot / walker",
  "Scooter",
  "Electronic toy",
  "Other",
];
export const PAID_SERVICE_NOTE =
  "Inspection charges apply. The repair cost will be shared with you after inspection, for your approval before any work begins.";
export const PAID_HOME_VISIT_NOTE = "Home visit / pickup charges apply.";
/** What the customer agrees to (tick box on the Paid Service form). */
export const PAID_AGREEMENT =
  "I agree to pay the inspection charge. I'll receive a repair quote after inspection, and repair work will start only after I approve it.";
export const PAID_HOME_AGREEMENT = "I also agree to pay the home visit / pickup charge.";

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
// Defaults only — the live price is set by the Super Admin (Settings → Extended Warranty).
export const EXTENDED_WARRANTY = {
  months: 6,
  fee: 1499,
  feeLabel: "₹1,499",
};
