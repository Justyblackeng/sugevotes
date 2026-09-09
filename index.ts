import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { getPollSettings, pollWindowError } from "../_shared/settings.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OTP_TTL_MINUTES = 10;

function generateCode(): string {
  // 6-digit numeric code, zero-padded
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendEmail(to: string, code: string): Promise<{ sent: boolean }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("OTP_FROM_EMAIL") || "SUMAS E-VOTE <onboarding@resend.dev>";

  if (!apiKey) {
    // No email provider configured. In this mode the code is returned
    // directly in the API response (see handler below) so the flow is
    // still testable end-to-end without setting up email. This must
    // not be relied on in production — see README.
    return { sent: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Your SUMAS E-VOTE verification code",
      html: `
        <p>Your one-time verification code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p>
        <p>This code expires in ${OTP_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.</p>
      `,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Email send failed: ${errText}`);
  }

  return { sent: true };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: "invalid_body" }, 400);
  }

  const matric = String(body.matric || "").trim().toUpperCase();
  const fullName = String(body.fullName || "").trim();
  const faculty = String(body.faculty || "").trim();
  const email = String(body.email || "").trim().toLowerCase();

  if (!matric || !fullName || !faculty || !email) {
    return jsonResponse({ ok: false, error: "missing_fields" }, 200);
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return jsonResponse({ ok: false, error: "invalid_email" }, 200);
  }

  try {
    const settings = await getPollSettings(supabase);
    const windowError = pollWindowError(settings);
    if (windowError) {
      return jsonResponse({ ok: false, error: windowError }, 200);
    }

    // Already voted?
    const { data: votedRow, error: votedErr } = await supabase
      .from("voted_log")
      .select("matric")
      .eq("matric", matric)
      .maybeSingle();
    if (votedErr) throw votedErr;
    if (votedRow) {
      return jsonResponse({ ok: false, error: "already_voted" }, 200);
    }

    // Voter roll check — only enforced if the roll table has entries.
    const { count: rollCount, error: countErr } = await supabase
      .from("voter_roll")
      .select("matric", { count: "exact", head: true });
    if (countErr) throw countErr;

    if (rollCount && rollCount > 0) {
      const { data: rollRow, error: rollErr } = await supabase
        .from("voter_roll")
        .select("matric")
        .eq("matric", matric)
        .maybeSingle();
      if (rollErr) throw rollErr;
      if (!rollRow) {
        return jsonResponse({ ok: false, error: "not_on_roll" }, 200);
      }
    }

    // Generate and store the code (overwrites any previous unused code for this matric)
    const code = generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: upsertErr } = await supabase
      .from("otp_codes")
      .upsert({ matric, code, expires_at: expiresAt, attempts: 0 });
    if (upsertErr) throw upsertErr;

    const emailResult = await sendEmail(email, code);

    const response: any = { ok: true, emailSent: emailResult.sent };
    if (!emailResult.sent) {
      // Dev-mode fallback only — see sendEmail() comment above.
      response.devCode = code;
    }

    return jsonResponse(response, 200);
  } catch (_e) {
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
});
