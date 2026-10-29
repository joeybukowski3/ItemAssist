const { callEngine } = require("../replacement-finder/engine-client");

const RESEARCH_PATH = "/api/itemassist-research";
// The engine's own provider timeout is 5.5 s (plus ~0.8 s of store round trips). 8 s leaves room for the network and a cold start
// and still ends before a 10 s platform function limit, so the proxy settles its reservation instead of being killed mid-request.
const RESEARCH_TIMEOUT_MS = 8000;

/**
 * One server-to-server call to the ItemAssist Research engine route. It reuses the v1 transport unchanged, so the engine
 * origin rules (https, no credentials), the manual-redirect refusal, the response-size cap, the single attempt and the
 * header-only bearer token are all inherited. Only the path differs: the v1 transport hands the fetch function a URL on the
 * validated engine origin, and this wrapper swaps that URL's path for the research route on the SAME origin.
 *
 * Resolves to { kind: "response", status, body } or { kind: "misconfigured" | "timeout" | "network" | "bad_response" }.
 */
function callResearchEngine({ baseUrl, token, query, timeoutMs = RESEARCH_TIMEOUT_MS, fetchImpl = fetch }) {
  const toResearchRoute = (href, init) => fetchImpl(new URL(RESEARCH_PATH, href).href, init);
  return callEngine({ baseUrl, token, payload: { query }, timeoutMs, fetchImpl: toResearchRoute });
}

// Engine error codes -> the fixed proxy vocabulary. Anything not listed becomes ENGINE_ERROR; raw engine text is never used.
const ENGINE_ERROR_MAP = Object.freeze({
  BUDGET_EXHAUSTED: { code: "CAPACITY_REACHED", status: 503 },
  API_DISABLED: { code: "SERVICE_UNAVAILABLE", status: 503 },
  UNAUTHORIZED: { code: "SERVICE_UNAVAILABLE", status: 503 },
  BUDGET_UNAVAILABLE: { code: "SERVICE_UNAVAILABLE", status: 503 },
  PROVIDER_UNAVAILABLE: { code: "SERVICE_UNAVAILABLE", status: 503 }
});
const ENGINE_FAILURE = Object.freeze({ code: "ENGINE_ERROR", status: 502 });

/** Maps a failed engine call (or an engine error body) to `{ code, status }`. */
function mapResearchFailure(result) {
  if (result.kind === "misconfigured") return { code: "SERVICE_UNAVAILABLE", status: 503 };
  if (result.kind === "timeout") return { code: "ENGINE_TIMEOUT", status: 504 };
  if (result.kind === "response" && result.body && typeof result.body === "object" && typeof result.body.errorCode === "string"
    && Object.prototype.hasOwnProperty.call(ENGINE_ERROR_MAP, result.body.errorCode)) {
    return ENGINE_ERROR_MAP[result.body.errorCode];
  }
  return ENGINE_FAILURE;
}

module.exports = { callResearchEngine, mapResearchFailure, RESEARCH_PATH, RESEARCH_TIMEOUT_MS };
