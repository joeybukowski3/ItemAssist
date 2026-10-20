/** Sample ItemAssist Research responses shaped like the proxy's public contract (research.1). Shared by the unit and Playwright tests. */

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

module.exports = { researchResponse, researchGuidance, researchError, DISCLOSURE };
