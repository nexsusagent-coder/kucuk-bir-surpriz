function getTurkeyTime() {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    return formatter.format(now);
  } catch (err) {
    return new Date().toISOString();
  }
}

function sanitizeTaskCode(raw) {
  if (!raw || typeof raw !== "string") return "FIRST-TASK";
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return cleaned || "FIRST-TASK";
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = [
    "https://nexsusagent-coder.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ];
  if (env.ALLOWED_ORIGIN && !allowedOrigins.includes(env.ALLOWED_ORIGIN)) {
    allowedOrigins.push(env.ALLOWED_ORIGIN);
  }

  const isAllowed = allowedOrigins.includes(origin);
  const allowOriginHeader = isAllowed ? origin : (env.ALLOWED_ORIGIN || "https://nexsusagent-coder.github.io");

  return {
    "Access-Control-Allow-Origin": allowOriginHeader,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json"
  };
}

function jsonResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. Health endpoint
      if (request.method === "GET" && path === "/health") {
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      // 2. Event endpoint
      if (request.method === "POST" && path === "/event") {
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) {
          return jsonResponse({ ok: false, error: "invalid_content_type" }, 400, corsHeaders);
        }

        const body = await request.json().catch(() => null);
        if (!body || body.experience !== "bugunden-bir-kare") {
          return jsonResponse({ ok: false, error: "invalid_experience" }, 400, corsHeaders);
        }

        const allowedActions = ["send_to_me", "keep_private"];
        if (!allowedActions.includes(body.action)) {
          return jsonResponse({ ok: false, error: "invalid_action" }, 400, corsHeaders);
        }

        const taskCode = sanitizeTaskCode(body.taskCode);
        const taskSummary = (body.taskSummary && typeof body.taskSummary === "string") ? body.taskSummary.slice(0, 60) : "";
        const taskInfo = taskSummary ? `${taskSummary} (${taskCode})` : taskCode;
        const timeStr = getTurkeyTime();
        let messageText = "";

        if (body.action === "send_to_me") {
          messageText = `📷 BUGÜNDEN BİR KARE\n\nGörev: ${taskInfo}\nSeçim: Sana göndereceğim\nSaat: ${timeStr}`;
        } else if (body.action === "keep_private") {
          messageText = `📷 BUGÜNDEN BİR KARE\n\nGörev: ${taskInfo}\nSeçim: Kendime saklayacağım\nSaat: ${timeStr}`;
        }

        if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
          return jsonResponse({ ok: false, error: "telegram_secrets_missing" }, 500, corsHeaders);
        }

        const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const tgRes = await fetch(tgUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: messageText
          })
        });

        const tgData = await tgRes.json().catch(() => null);
        if (tgRes.ok && tgData && tgData.ok) {
          return jsonResponse({ ok: true }, 200, corsHeaders);
        } else {
          return jsonResponse({ ok: false, error: "telegram_delivery_failed" }, 502, corsHeaders);
        }
      }

      // 3. Photo endpoint
      if (request.method === "POST" && path === "/photo") {
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.includes("multipart/form-data")) {
          return jsonResponse({ ok: false, error: "invalid_content_type" }, 400, corsHeaders);
        }

        const formData = await request.formData().catch(() => null);
        if (!formData) {
          return jsonResponse({ ok: false, error: "invalid_form_data" }, 400, corsHeaders);
        }

        const photo = formData.get("photo");
        if (!photo || typeof photo === "string") {
          return jsonResponse({ ok: false, error: "missing_photo_file" }, 400, corsHeaders);
        }

        const MAX_SIZE = 9 * 1024 * 1024;
        if (photo.size > MAX_SIZE) {
          return jsonResponse({ ok: false, error: "photo_too_large" }, 400, corsHeaders);
        }

        const taskCode = sanitizeTaskCode(formData.get("taskCode"));
        const rawTaskSummary = formData.get("taskSummary");
        const taskSummary = (rawTaskSummary && typeof rawTaskSummary === "string") ? rawTaskSummary.slice(0, 60) : "";
        const taskInfo = taskSummary ? `${taskSummary} (${taskCode})` : taskCode;
        const timeStr = getTurkeyTime();
        const caption = `📷 BUGÜNDEN BİR KARE\n\nGörev: ${taskInfo}\nSeçim: Buraya bırakacağım\nSaat: ${timeStr}`;

        if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
          return jsonResponse({ ok: false, error: "telegram_secrets_missing" }, 500, corsHeaders);
        }

        const tgFormData = new FormData();
        tgFormData.append("chat_id", env.TELEGRAM_CHAT_ID);
        tgFormData.append("caption", caption);
        tgFormData.append("photo", photo, photo.name || "bugunden-bir-kare.jpg");

        const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
        const tgRes = await fetch(tgUrl, {
          method: "POST",
          body: tgFormData
        });

        const tgData = await tgRes.json().catch(() => null);
        if (tgRes.ok && tgData && tgData.ok) {
          return jsonResponse({ ok: true }, 200, corsHeaders);
        } else {
          return jsonResponse({ ok: false, error: "telegram_delivery_failed" }, 502, corsHeaders);
        }
      }

      return jsonResponse({ ok: false, error: "not_found" }, 404, corsHeaders);
    } catch (err) {
      return jsonResponse({ ok: false, error: "internal_error" }, 500, corsHeaders);
    }
  }
};
