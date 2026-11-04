// Messages for the extended warranty flow (server only).

import { findRecipients, notifyCustomer, notifyStaff, siteUrl } from "@/lib/notify";
import { formatDate } from "@/lib/helpers";
import type { WarrantyForExtension } from "@/lib/extended-warranty";

export function extendLink(token: string) {
  return `${siteUrl()}/extend/${token}`;
}

export async function alertInspectionTeam(w: WarrantyForExtension, title: string, summary: string) {
  const people = await findRecipients(["store_manager", "technician", "service_head"], w.store_name);
  await notifyStaff(people, {
    ticketType: null,
    ticketId: null,
    ticketNumber: w.warranty_number,
    title,
    summary,
    details: [`Product: ${w.product_name} (serial ${w.serial_number})`, `Bill ${w.bill_number}`],
    storeName: w.store_name,
    link: `${siteUrl()}/staff/extended-warranty`,
  });
}

export async function tellCustomerActive(w: WarrantyForExtension, expiry: string) {
  await notifyCustomer({
    name: w.customer_name,
    mobile: w.customer_mobile,
    ticketNumber: w.warranty_number,
    message: `Your Extended Warranty for ${w.product_name} is active. You are covered until ${formatDate(expiry)}. Your updated certificate:`,
    link: `${siteUrl()}/warranty/${w.verification_token}`,
  });
}
