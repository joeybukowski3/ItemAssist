/** Sample engine contracts shaped like the engine's public response. Shared by the unit, endpoint and Playwright tests. */
const row = (key, label, importance, original, replacement, code, assessmentLabel, note = null) => ({
  key, label, importance, original, replacement, assessment: { code, label: assessmentLabel }, note
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
      explanation: "Matches the original screen size and resolution. Physical fit could not be verified.", isBestAvailableOnly: false
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
      { brand: "Samsung", model: "QN55QN90D", displayName: "Samsung QN55QN90D", classification: "ABOVE_LKQ", confidence: "MEDIUM", role: "ABOVE_LKQ_OPTION", roleLabel: "Above like-kind-and-quality", differences: ["Display performance class: Neo QLED (recommended model: QLED)"] }
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
    explanation: "No current model met every required specification, so this is the closest available option and not a like-kind-and-quality replacement.", isBestAvailableOnly: true
  },
  warnings: [{ code: "NO_LKQ_CANDIDATE", severity: "BLOCKING", message: "No current model met every required specification. The model shown is the closest available, not a like-kind-and-quality replacement." }]
});

const engineNoResult = () => engineComplete({
  status: "NO_RESULT", retrievalQuality: "FAILED", primary: null, comparison: [], alternatives: [], sources: [],
  warnings: [{ code: "NO_CANDIDATES", severity: "WARNING", message: "No replacement candidates could be retrieved." }], needsVerification: []
});

const engineError = (errorCode, status = errorCode === "UNSUPPORTED" ? "UNSUPPORTED" : "ERROR") => ({ contractVersion: "1", status, errorCode, message: "engine text that must never be forwarded", requestId: "engine-req-9" });


module.exports = { engineComplete, enginePartial, engineBestAvailable, engineNoResult, engineError };
