import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!;

// Network hiccups between the web server and Supabase used to make a login or a
// page fail now and then. Reads are retried (they are safe to repeat); writes are
// retried only when the connection could not be opened at all, so nothing is saved twice.
const CONNECT_ERRORS = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET/i;

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const safe = method === "GET" || method === "HEAD";
  const attempts = 3;

  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(input, {
        ...init,
        // Always fresh data from the database (never a stored copy).
        cache: "no-store",
        // A normal read takes well under a second: give up on a stuck one quickly and retry.
        signal: init?.signal ?? AbortSignal.timeout(safe ? 6_000 : 20_000),
      });
      if (safe && attempt < attempts && [502, 503, 504].includes(response.status)) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
      return response;
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
      const text = `${cause?.code ?? ""} ${cause?.message ?? ""} ${error instanceof Error ? error.message : ""}`;
      const retryable = safe || CONNECT_ERRORS.test(text);
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: { fetch: resilientFetch },
});
