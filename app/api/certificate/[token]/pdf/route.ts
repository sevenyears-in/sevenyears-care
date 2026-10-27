import { supabaseAdmin } from "@/lib/supabase/server";
import { buildCertificatePdf, type CertificateData } from "@/lib/certificate-pdf";

// GET /api/certificate/<token>/pdf          → downloads the PDF
// GET /api/certificate/<token>/pdf?view=1   → opens it in the browser
// The token is a long random value printed only on that customer's certificate.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!/^[a-f0-9]{16,64}$/i.test(token)) {
    return new Response("Certificate not found.", { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("warranties")
    .select(
      "warranty_number, verification_token, bill_number, bill_date, store_name, product_name, sku, category_name, model_number, serial_number, customer_name, customer_mobile, customer_address, warranty_start_date, standard_warranty_expiry_date, extended_warranty_purchased, extended_warranty_start_date, extended_warranty_expiry_date, warranty_expiry_date, status, created_at"
    )
    .eq("verification_token", token)
    .maybeSingle();

  if (error) {
    console.error("Certificate PDF lookup error:", error);
    return new Response("Unable to create the certificate.", { status: 500 });
  }
  if (!data) return new Response("Certificate not found.", { status: 404 });

  const url = new URL(request.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || url.origin;

  try {
    const bytes = await buildCertificatePdf(data as CertificateData, siteUrl);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const fileName = `Warranty-${data.warranty_number}.pdf`;
    const disposition = url.searchParams.get("view") ? "inline" : "attachment";

    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (pdfError) {
    console.error("Certificate PDF build error:", pdfError);
    return new Response(
      "Unable to create the PDF. Make sure the pdf-lib package is installed (npm install pdf-lib).",
      { status: 500 }
    );
  }
}
