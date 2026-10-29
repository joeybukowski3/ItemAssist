/** Sample ItemAssist Research responses shaped like the proxy's public contract (research.1; research2Response builds research.2). Shared by the unit and Playwright tests. */

const DISCLOSURE = "AI estimate from general product knowledge. Specifications, model numbers, availability and pricing have not been verified and may be out of date.";

function researchResponse(overrides = {}) {
  return {
    contractVersion: "research.1",
    kind: "ITEMASSIST_RESEARCH",
    status: "OK",
    category: "tv",
    original: {
      identity: "LG C3 series 4K OLED smart TV", confidence: "HIGH",
      characteristics: ["OLED panel", "4K resolution", "120 Hz refresh"], uncertainty: "Screen size was not given"
    },
    requirements: ["Same screen size class", "OLED or better panel", "4K resolution", "At least 4 HDMI 2.1 ports", "Similar smart TV platform"],
    requirementsSource: "AI_ESTIMATE",
    successor: {
      name: "LG C-series OLED, next generation", why: "Direct successor line with the same panel type.", differences: "Brighter panel, newer processor",
      concern: "Fewer HDMI 2.1 ports in some sizes", confidence: "HIGH", standing: "CONDITIONAL", verified: false
    },
    suggestions: [
      { name: "Samsung S90 series QD-OLED", why: "Comparable premium OLED-class picture.", differences: "Different smart platform.", confidence: "MEDIUM", verified: false },
      { name: "Sony Bravia 8 OLED", why: "Similar tier with strong processing.", differences: "Fewer gaming features on some sizes.", confidence: "MEDIUM", verified: false }
    ],
    clarify: ["Which screen size do you have?"],
    disclosure: DISCLOSURE,
    warnings: ["SUCCESSOR_CONDITIONAL"],
    meta: { requestId: "proxy-req-1", elapsedMs: 900, cached: false, answerSource: "AI_ESTIMATE" },
    quota: { limit: 5, remaining: 4, charged: true },
    ...overrides
  };
}

const researchGuidance = () => researchResponse({
  status: "UNAVAILABLE",
  original: { identity: null, confidence: "LOW", characteristics: [], uncertainty: "This product could not be identified from the description." },
  requirementsSource: "CATEGORY_GUIDANCE", successor: null, suggestions: [], clarify: [],
  warnings: ["PROVIDER_UNAVAILABLE", "PRODUCT_NOT_IDENTIFIED", "REQUIREMENTS_FROM_CATEGORY_GUIDANCE"],
  meta: { requestId: "proxy-req-2", elapsedMs: 5400, cached: false, answerSource: "CATEGORY_GUIDANCE" },
  quota: { limit: 5, remaining: 5, charged: false }
});

const researchError = (errorCode, quota) => ({
  contractVersion: "research.1", kind: "ITEMASSIST_RESEARCH", status: "ERROR", errorCode, message: "server text the page must not show", requestId: "proxy-req-9",
  ...(quota ? { quota } : {})
});

const fs = require("fs");
const path = require("path");

/**
 * A research.2 response exactly as the proxy would send it: a golden engine response (built by the backend's own builder) projected through the
 * real projection. research.2 is a Preview demo, so the projected response always carries the demo indicator (`meta.fixture: true`).
 * `overrides` is applied to the projected result.
 */
function research2Response(scenario, overrides = {}) {
  const { projectResearch } = require("../../../api/_lib/itemassist-research/projection.js");
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "research2-golden.json"), "utf8"));
  const entry = golden.scenarios[scenario];
  if (!entry) throw new Error("unknown research.2 scenario: " + scenario);
  const projected = projectResearch(JSON.parse(JSON.stringify(entry.engine)), { requestId: "proxy-req-v2", elapsedMs: 900, quota: { limit: 5, remaining: 4, charged: true }, allowFixture: true });
  return { ...projected, ...overrides };
}

/**
 * The same, as a LIVE answer: the engine body without the demo marker, projected with the server's live switch on. `change` edits the
 * engine body first (for example to give the original dated prices). The result never carries `meta.fixture`.
 */
function research2LiveResponse(scenario, change = () => {}) {
  const { projectResearch } = require("../../../api/_lib/itemassist-research/projection.js");
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "research2-golden.json"), "utf8"));
  const entry = golden.scenarios[scenario];
  if (!entry) throw new Error("unknown research.2 scenario: " + scenario);
  const body = JSON.parse(JSON.stringify(entry.engine));
  delete body.meta.fixture;
  change(body);
  const projected = projectResearch(body, { requestId: "proxy-req-live", elapsedMs: 900, quota: { limit: 5, remaining: 4, charged: true }, allowFixture: false, allowLive: true });
  if (!projected) throw new Error("the live projection refused the " + scenario + " body");
  return projected;
}

const RESEARCH2_SCENARIOS = Object.freeze(["tv-premium-oled", "tv-strong-retail", "fridge-constraints", "washer-dimensions", "ambiguous-model", "sparse-estimate", "unsupported-claims", "insufficient"]);

module.exports = { researchResponse, researchGuidance, researchError, research2Response, research2LiveResponse, RESEARCH2_SCENARIOS, DISCLOSURE };
