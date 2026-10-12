/** Sample engine contracts shaped like the engine's public response. Shared by the unit, endpoint and Playwright tests. */
const row = (key, label, importance, original, replacement, code, assessmentLabel, note = null) => ({
  key, label, importance, original, replacement, assessment: { code, label: assessmentLabel }, note
});

/** Availability evidence exactly as the engine's public contract shapes it (see lib/replacement-public/contract.js buildRetail). */
const retail = (overrides = {}) => ({
  statusLabel: "AVAILABLE NEW", condition: "NEW", purchaseStatus: "AVAILABLE", catalogStatus: "CURRENT", sellerType: "MANUFACTURER",
  sourceName: "Samsung.com", sourceDomain: "samsung.com", sourceUrl: "https://www.samsung.com/us/tvs/q80d/",
  observedPrice: { amount: 999.99, currency: "USD" }, observedAt: "2026-10-11T14:30:00.000Z", ...overrides
});

/** A COMPLETE engine contract, shaped like the engine's public response. */
function engineComplete(overrides = {}) {
  return {
    contractVersion: "1",
    status: "COMPLETE",
    category: "television",
    retrievalQuality: "STRONG",
    original: {
      brand: "Samsung", model: "QN55Q80C", displayName: "Samsung QN55Q80C",
      facts: [
        { key: "model", label: "Model", value: "QN55Q80C", status: "VERIFIED" },
        { key: "screenSizeIn", label: "Screen size", value: "55\"", status: "VERIFIED" },
        { key: "tier", label: "Product tier", value: "Premium", status: "INFERRED" },
        { key: "physicalFit", label: "Physical fit", value: null, status: "UNKNOWN" }
      ]
    },
    primary: {
      brand: "Samsung", model: "QN55Q80D", displayName: "Samsung QN55Q80D", classification: "LKQ", confidence: "MEDIUM",
      explanation: "Matches the original screen size and resolution. Physical fit could not be verified.", isBestAvailableOnly: false,
      recommendationLevel: "RECOMMENDED", retail: retail()
    },
    comparison: [
      row("screenSizeIn", "Screen size", "REQUIRED", "55\"", "55\"", "MATCH", "Meets requirement"),
      row("resolution", "Resolution", "REQUIRED", "4K", "4K", "MATCH", "Meets requirement"),
      row("displayTechnology", "Display performance class", "IMPORTANT", "QLED", "QLED", "MATCH", "Match"),
      row("series", "Model family or series", "IMPORTANT", "Q80 Series", "Q80 Series", "MATCH", "Match"),
      row("physicalFit", "Physical fit", "REQUIRED", null, null, "VERIFY", "Needs verification", "Not verified. Confirm available space before purchase"),
      row("modelYear", "Model year", "ADDITIONAL", "2023", "2024", "DIFFERS", "Differs")
    ],
    alternatives: [
      { brand: "Samsung", model: "QN55QN90D", displayName: "Samsung QN55QN90D", classification: "ABOVE_LKQ", confidence: "MEDIUM", recommendationLevel: "RECOMMENDED",
        retail: retail({ sellerType: "RETAILER", sourceName: "Best Buy", sourceDomain: "bestbuy.com", sourceUrl: "https://www.bestbuy.com/site/qn90d/1.p", observedPrice: { amount: 1499, currency: "USD" } }), role: "ABOVE_LKQ_OPTION", roleLabel: "Above like-kind-and-quality", differences: ["Display performance class: Neo QLED (recommended model: QLED)"] }
    ],
    warnings: [],
    needsVerification: [{ key: "physicalFit", label: "Physical fit", reason: "UNVERIFIED_FIT", message: "Not verified. Confirm available space before purchase" }],
    refinements: [{ fieldKey: "physicalFit", prompt: "What is the maximum width/height of the space?" }],
    sources: [
      { domain: "samsung.com", url: "https://www.samsung.com/us/tvs/q80c/", role: "ORIGINAL" },
      { domain: "samsung.com", url: "https://www.samsung.com/us/tvs/q80d/", role: "REPLACEMENT" }
    ],
    meta: { requestId: "engine-req-1", elapsedMs: 8123, engineVersion: "1.0.0", profileVersion: "1.0.0", cached: false },
    ...overrides
  };
}

const enginePartial = () => engineComplete({
  status: "PARTIAL", retrievalQuality: "PARTIAL",
  warnings: [{ code: "DEADLINE_REACHED", severity: "WARNING", message: "Research stopped at the time limit, so some products may not have been evaluated." }],
  needsVerification: [{ key: "research", label: "Research completeness", reason: "PARTIAL_DEADLINE", message: "Research stopped at the time limit. Some products may not have been fully evaluated." }]
});

const engineBestAvailable = () => engineComplete({
  primary: {
    brand: "Samsung", model: "QN55Q80D", displayName: "Samsung QN55Q80D", classification: "NOT_LKQ", confidence: "MEDIUM",
    explanation: "No current model met every required specification, so this is the closest available option and not a like-kind-and-quality replacement.", isBestAvailableOnly: true,
    recommendationLevel: "BEST_AVAILABLE", retail: retail()
  },
  warnings: [{ code: "NO_LKQ_CANDIDATE", severity: "BLOCKING", message: "No current model met every required specification. The model shown is the closest available, not a like-kind-and-quality replacement." }]
});

/** The QN55Q80C case: a current successor that is available new but cannot be confirmed as LKQ. */
const engineBestAvailableUnconfirmed = () => engineComplete({
  original: {
    brand: "Samsung", model: "QN55Q80C", displayName: "Samsung QN55Q80C",
    facts: [
      { key: "model", label: "Model", value: "QN55Q80C", status: "VERIFIED" },
      { key: "series", label: "Model family or series", value: "Q80 Series", status: "VERIFIED" },
      { key: "screenSizeIn", label: "Screen size", value: "55\"", status: "VERIFIED" },
      { key: "tier", label: "Product tier", value: "Premium", status: "INFERRED" },
      { key: "physicalFit", label: "Physical fit", value: null, status: "UNKNOWN" }
    ]
  },
  primary: {
    brand: "Samsung", model: "QN55QN80H", displayName: "Samsung QN55QN80H", classification: "UNCONFIRMED", confidence: "MEDIUM",
    explanation: "This is the closest current model Samsung sells new. Some important specifications could not be verified, so it is not confirmed as a like-kind-and-quality match.",
    isBestAvailableOnly: true, recommendationLevel: "BEST_AVAILABLE",
    retail: retail({ sourceUrl: "https://www.samsung.com/us/tvs/qn80h/" })
  },
  comparison: [
    row("screenSizeIn", "Screen size", "REQUIRED", "55\"", "55\"", "MATCH", "Meets requirement"),
    row("resolution", "Resolution", "REQUIRED", "4K", "4K", "MATCH", "Meets requirement"),
    row("displayTechnology", "Display performance class", "IMPORTANT", "QLED", "Neo QLED", "EXCEEDS", "Exceeds"),
    row("hdrFormat", "HDR support", "IMPORTANT", null, "HDR10+", "UNKNOWN", "Not verified", "Original HDR support could not be verified"),
    row("modelYear", "Model year", "ADDITIONAL", "2023", "2025", "DIFFERS", "Differs")
  ],
  alternatives: [],
  warnings: [
    { code: "NO_CONFIRMED_LKQ", severity: "BLOCKING", message: "No current model could be confirmed as a like-kind-and-quality replacement. The model shown is the closest available new option, not an equivalent." },
    { code: "ORIGINAL_SOURCE_NON_US", severity: "WARNING", message: "The original model’s specifications came from a non-U.S. Samsung page, which may differ from the U.S. model. Verify them before buying." }
  ],
  needsVerification: [
    { key: "hdrFormat", label: "HDR support", reason: "UNKNOWN", message: "Original HDR support could not be verified" },
    { key: "physicalFit", label: "Physical fit", reason: "UNVERIFIED_FIT", message: "Not verified. Confirm available space before purchase" }
  ],
  sources: [
    { domain: "samsung.com", url: "https://www.samsung.com/ca/tvs/q80c/", role: "ORIGINAL" },
    { domain: "samsung.com", url: "https://www.samsung.com/us/tvs/qn80h/", role: "REPLACEMENT" },
    { domain: "rtings.com", url: "https://www.rtings.com/tv/reviews/samsung/qn80h", role: "SUPPORT" }
  ]
});

/** Nothing sold new and currently available was found, so nothing is recommended. */
const engineNoRetailReplacement = () => engineComplete({
  status: "NO_RESULT", retrievalQuality: "PARTIAL", primary: null, comparison: [], alternatives: [], sources: [{ domain: "samsung.com", url: "https://www.samsung.com/us/tvs/q80c/", role: "ORIGINAL" }],
  warnings: [{ code: "NO_CURRENT_RETAIL_REPLACEMENT", severity: "BLOCKING", message: "No replacement was found that is sold new and currently available from the manufacturer or a major U.S. retailer. Older or unavailable models are not recommended." }],
  needsVerification: []
});

const engineNoResult = () => engineComplete({
  status: "NO_RESULT", retrievalQuality: "FAILED", primary: null, comparison: [], alternatives: [], sources: [],
  warnings: [{ code: "NO_CANDIDATES", severity: "WARNING", message: "No replacement candidates could be retrieved." }], needsVerification: []
});

const engineError = (errorCode, status = errorCode === "UNSUPPORTED" ? "UNSUPPORTED" : "ERROR") => ({ contractVersion: "1", status, errorCode, message: "engine text that must never be forwarded", requestId: "engine-req-9" });


module.exports = { engineComplete, enginePartial, engineBestAvailable, engineBestAvailableUnconfirmed, engineNoRetailReplacement, engineNoResult, engineError, retail };
