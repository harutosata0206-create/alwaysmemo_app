const LANGUAGES = new Set(["ja", "en", "es", "pt-BR", "ko"]);
const ENVIRONMENTS = new Set(["production", "development", "test"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_KEYS = [
  "app_version", "environment", "event_id", "installation_id", "name",
  "occurred_at", "properties", "schema_version", "session_id", "ui_language",
].sort();

const eventSpecs = {
  analytics_enabled: {
    required: { install_evidence: ["preexisting", "unknown"] },
  },
  session_started: {
    required: { install_evidence: ["preexisting", "unknown"] },
  },
  memo_first_edited: {
    required: { became_non_empty: "boolean" },
  },
  core_action_succeeded: {
    required: {
      action: ["always_on_top", "focus", "snap_left", "snap_right", "snap_top", "snap_bottom", "fit_content", "minimum_size"],
      context: ["normal", "onboarding"],
      trigger: ["global_shortcut", "local_shortcut", "menu", "settings"],
    },
  },
  onboarding_event: {
    required: { action: ["shown", "step_viewed", "step_succeeded", "completed", "skipped"] },
    optional: { step: ["snap", "alwaysOnTop", "focus", "fitContent"] },
  },
  prompt_event: {
    required: {
      prompt: ["default_app", "review"],
      action: ["shown", "later", "dismissed", "opened"],
    },
  },
  file_operation: {
    required: {
      operation: ["open", "save", "save_as", "save_all"],
      outcome: ["success", "cancelled", "failure"],
    },
    optional: {
      error_category: ["dialog", "permission", "not_found", "read", "write", "window", "unknown"],
    },
  },
};

function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function isAllowedValue(value, rule) {
  if (rule === "boolean") return typeof value === "boolean";
  return typeof value === "string" && rule.includes(value);
}

function isValidProperties(name, properties) {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  if (!Object.hasOwn(eventSpecs, name)) return false;
  const spec = eventSpecs[name];
  if (!spec) return false;
  const required = Object.keys(spec.required);
  const optional = Object.keys(spec.optional ?? {});
  const keys = Object.keys(properties);
  if (required.some((key) => !keys.includes(key))) return false;
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) return false;
  return [...required, ...optional].every((key) =>
    properties[key] === undefined ||
    isAllowedValue(properties[key], spec.required[key] ?? spec.optional[key]),
  );
}

export function validateBatch(body, now = Date.now()) {
  if (!body || typeof body !== "object" || !hasExactKeys(body, ["events"])) {
    return { ok: false, error: "invalid_body" };
  }
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 20) {
    return { ok: false, error: "invalid_batch_size" };
  }
  const oldest = now - 31 * 24 * 60 * 60 * 1000;
  const newest = now + 10 * 60 * 1000;
  for (const event of body.events) {
    if (!event || typeof event !== "object" || !hasExactKeys(event, EVENT_KEYS)) {
      return { ok: false, error: "invalid_event_shape" };
    }
    const occurredAt = Date.parse(event.occurred_at);
    if (
      event.schema_version !== 1 ||
      !UUID.test(event.event_id) ||
      !UUID.test(event.installation_id) ||
      !UUID.test(event.session_id) ||
      typeof event.app_version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(event.app_version) ||
      !LANGUAGES.has(event.ui_language) ||
      !ENVIRONMENTS.has(event.environment) ||
      !Number.isFinite(occurredAt) ||
      occurredAt < oldest ||
      occurredAt > newest ||
      !isValidProperties(event.name, event.properties)
    ) {
      return { ok: false, error: "invalid_event" };
    }
  }
  return { ok: true };
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return new Response("ok", { status: 200 });
    }
    if (url.pathname !== "/v1/events") return new Response("not found", { status: 404 });

    const origin = request.headers.get("Origin") ?? "";
    const allowedOrigins = new Set(
      (env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    );
    if (!allowedOrigins.has(origin)) return new Response("forbidden", { status: 403 });
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 64 * 1024) return json({ error: "payload_too_large" }, 413, origin);
    const text = await request.text();
    if (text.length > 64 * 1024) return json({ error: "payload_too_large" }, 413, origin);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "invalid_json" }, 400, origin);
    }
    const validation = validateBatch(body);
    if (!validation.ok) return json({ error: validation.error }, 400, origin);

    const statement = env.DB.prepare(
      `INSERT OR IGNORE INTO analytics_events
       (event_id, occurred_at, received_at, installation_id, session_id, app_version,
        schema_version, ui_language, environment, event_name, properties_json)
       VALUES (?, ?, unixepoch(), ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await env.DB.batch(body.events.map((event) =>
      statement.bind(
        event.event_id, event.occurred_at, event.installation_id, event.session_id,
        event.app_version, event.schema_version, event.ui_language, event.environment,
        event.name, JSON.stringify(event.properties),
      ),
    ));
    return json({ accepted: body.events.length }, 202, origin);
  },

  async scheduled(_controller, env) {
    await env.DB.prepare(
      "DELETE FROM analytics_events WHERE received_at < unixepoch() - (90 * 24 * 60 * 60)",
    ).run();
  },
};
