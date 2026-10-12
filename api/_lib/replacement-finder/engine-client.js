const ENGINE_PATH = "/api/itemassist-replacement";
const DEFAULT_TIMEOUT_MS = 24000;
const MAX_RESPONSE_BYTES = 200000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The engine origin must be https (plain http only for local development), carry no credentials, and is reduced to its
 * origin so the path is always the fixed engine route. Returns null for anything else.
 */
function resolveEngineUrl(baseUrl) {
  try {
    const url = new URL(String(baseUrl || ""));
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
    if (!secure || url.username || url.password) return null;
    return new URL(ENGINE_PATH, url.origin);
  } catch (error) {
    return null;
  }
}

/**
 * One server-to-server call to the replacement engine. Never retried: a retry could double provider spend. Redirects are
 * refused so the bearer token can never be forwarded to another origin. The token only ever appears in the request header.
 *
 * Resolves to { kind: "response", status, body } or { kind: "misconfigured" | "timeout" | "network" | "bad_response" }.
 */
async function callEngine({ baseUrl, token, payload, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }) {
  const url = resolveEngineUrl(baseUrl);
  if (!url || typeof token !== "string" || token.trim() === "") return { kind: "misconfigured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      return { kind: controller.signal.aborted ? "timeout" : "network" };
    }
    if (response.status >= 300 && response.status < 400) return { kind: "bad_response" };
    const declared = Number(response.headers && typeof response.headers.get === "function" ? response.headers.get("content-length") : NaN);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return { kind: "bad_response" };
    let text;
    try {
      text = await response.text();
    } catch (error) {
      return { kind: controller.signal.aborted ? "timeout" : "network" };
    }
    if (text.length > MAX_RESPONSE_BYTES) return { kind: "bad_response" };
    try {
      return { kind: "response", status: response.status, body: JSON.parse(text) };
    } catch (error) {
      return { kind: "bad_response" };
    }
  } finally {
    clearTimeout(timer);
  }
}

// Engine error codes -> the fixed proxy error vocabulary. Anything not listed becomes ENGINE_ERROR.
const ENGINE_ERROR_MAP = Object.freeze({
  UNSUPPORTED: { code: "UNSUPPORTED", status: 422 },
  BUDGET_EXHAUSTED: { code: "CAPACITY_REACHED", status: 503 },
  API_DISABLED: { code: "SERVICE_UNAVAILABLE", status: 503 },
  UNAUTHORIZED: { code: "SERVICE_UNAVAILABLE", status: 503 },
  BUDGET_UNAVAILABLE: { code: "SERVICE_UNAVAILABLE", status: 503 },
  PROVIDER_UNAVAILABLE: { code: "SERVICE_UNAVAILABLE", status: 503 },
  RATE_LIMITED: { code: "SERVICE_UNAVAILABLE", status: 503 },
  ENGINE_TIMEOUT: { code: "ENGINE_TIMEOUT", status: 504 }
});
const ENGINE_FAILURE = Object.freeze({ code: "ENGINE_ERROR", status: 502 });

/** Maps a failed engine call (or an engine error body) to `{ code, status }`. Raw engine text is never consulted. */
function mapEngineFailure(result) {
  if (result.kind === "misconfigured") return { code: "SERVICE_UNAVAILABLE", status: 503 };
  if (result.kind === "timeout") return { code: "ENGINE_TIMEOUT", status: 504 };
  if (result.kind === "response" && result.body && typeof result.body === "object" && typeof result.body.errorCode === "string"
    && Object.prototype.hasOwnProperty.call(ENGINE_ERROR_MAP, result.body.errorCode)) {
    return ENGINE_ERROR_MAP[result.body.errorCode];
  }
  return ENGINE_FAILURE;
}

module.exports = { callEngine, mapEngineFailure, resolveEngineUrl, ENGINE_PATH, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES };
