import { NextResponse } from "next/server";

// Customer self-registration has been replaced by staff registration
// (Staff → Register Warranty, which fetches the bill from Zoho POS).

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Warranties are now registered by Seven Years staff at the store. Please contact your store.",
    },
    { status: 410 }
  );
}
