// Warranty service type, chosen per product when staff issue a warranty (client-safe).
// Warranties issued before this was added have no type (null) and show nothing new.

export type ServiceCoverage = "on_site" | "in_store";

export const SERVICE_COVERAGE: Record<ServiceCoverage, { title: string; badge: string; area: string; help: string; certificate: string }> = {
  on_site: {
    title: "On-Site Warranty Service",
    badge: "ON-SITE WARRANTY",
    area: "Eligible service area",
    help: "Customers residing within the designated service coverage area of the issuing store are eligible for warranty service at their registered address, subject to warranty terms and service availability.",
    certificate: "Service will be provided at the registered customer address, subject to warranty terms.",
  },
  in_store: {
    title: "In-Store Warranty Service",
    badge: "IN-STORE WARRANTY",
    area: "Outside service coverage area",
    help: "Customers residing outside the designated on-site service coverage area must bring the product to a designated Seven Years store for warranty inspection and service.",
    certificate: "Please bring the product to a designated Seven Years store for warranty inspection and service.",
  },
};

export const isServiceCoverage = (v: unknown): v is ServiceCoverage => v === "on_site" || v === "in_store";

/** Store name as saved on the warranty (e.g. VATAKARA). */
export const issuingStore = (store: string | null | undefined) => (store ?? "").trim() || "Seven Years";
