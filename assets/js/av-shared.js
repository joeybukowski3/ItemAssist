/*
 * Shared, dependency-free logic for the /request-age-verification page.
 * Loaded via <script> in the browser (defines window.AVShared) and required
 * directly in Node tests (module.exports), so the same code path is what
 * ships and what is tested.
 */
(function (root) {
  "use strict";

  var ALLOWED_QUERY_PARAMS = ["brand", "model", "category", "result_id", "source", "result_status"];
  var RESULT_STATUSES = ["resolved", "ambiguous", "no_match"];
  var MAX_PARAM_LENGTH = 80;

  var CUSTOMER_TYPES = [
    "insurance_carrier",
    "insurance_adjuster",
    "independent_adjuster",
    "restoration_or_claims_vendor",
    "property_manager",
    "repair_professional",
    "homeowner_or_consumer",
    "other"
  ];

  var PROFESSIONAL_CUSTOMER_TYPES = [
    "insurance_carrier",
    "insurance_adjuster",
    "independent_adjuster",
    "restoration_or_claims_vendor",
    "property_manager",
    "repair_professional"
  ];

  var REQUESTED_SERVICES = ["age_verification", "full_valuation", "unsure"];

  function sanitizeQueryValue(value, maxLength) {
    var limit = typeof maxLength === "number" ? maxLength : MAX_PARAM_LENGTH;

    if (typeof value !== "string") {
      return "";
    }

    var withoutControlChars = value.replace(/[\x00-\x1f<>]/g, "");
    var trimmed = withoutControlChars.trim();

    return trimmed.slice(0, limit);
  }

  function isValidResultStatus(value) {
    return RESULT_STATUSES.indexOf(value) !== -1;
  }

  /**
   * Reads only the allowlisted query parameters, ignores everything else,
   * and length-limits/sanitizes every retained value. Never returns raw,
   * untrusted HTML — callers must still use textContent/value assignment,
   * never innerHTML, when rendering these values.
   *
   * @param {URLSearchParams|Object} searchParams
   * @returns {{brand:string, model:string, category:string, resultId:string, source:string, resultStatus:string}}
   */
  function parseReferralParams(searchParams) {
    var get = function (key) {
      if (!searchParams) {
        return "";
      }
      if (typeof searchParams.get === "function") {
        var value = searchParams.get(key);
        return value === null || value === undefined ? "" : value;
      }
      return searchParams[key] || "";
    };

    var result = {
      brand: sanitizeQueryValue(get("brand")),
      model: sanitizeQueryValue(get("model")),
      category: sanitizeQueryValue(get("category")),
      resultId: sanitizeQueryValue(get("result_id"), 120),
      source: sanitizeQueryValue(get("source"), 40),
      resultStatus: sanitizeQueryValue(get("result_status"), 20)
    };

    if (!isValidResultStatus(result.resultStatus)) {
      result.resultStatus = "";
    }

    return result;
  }

  function isDecodeMyItemReferral(referral) {
    return Boolean(referral && referral.source === "decodemyitem");
  }

  var REFERRAL_INTRO_COPY = {
    resolved:
      "DecodeMyItem produced an automated age estimate. Submit the item for human review, supporting-source research, and a professionally documented conclusion.",
    ambiguous:
      "DecodeMyItem identified multiple possible manufacture years. Item Assist can perform deeper model and serial research to provide the strongest supportable conclusion.",
    no_match:
      "Automated research could not confirm the item’s age. Item Assist can conduct a human-reviewed search using model records, serial information, photos, and available public sources."
  };

  function getReferralIntroCopy(resultStatus) {
    return REFERRAL_INTRO_COPY[resultStatus] || "";
  }

  function isProfessionalCustomerType(customerType) {
    return PROFESSIONAL_CUSTOMER_TYPES.indexOf(customerType) !== -1;
  }

  function generateRequestId(now, randomBytesHex) {
    var date = now instanceof Date ? now : new Date();
    var datePart =
      date.getUTCFullYear().toString() +
      String(date.getUTCMonth() + 1).padStart(2, "0") +
      String(date.getUTCDate()).padStart(2, "0");
    var randomPart = (randomBytesHex || "").slice(0, 8).toUpperCase();

    return "IAV-" + datePart + "-" + randomPart;
  }

  var api = {
    ALLOWED_QUERY_PARAMS: ALLOWED_QUERY_PARAMS,
    RESULT_STATUSES: RESULT_STATUSES,
    CUSTOMER_TYPES: CUSTOMER_TYPES,
    PROFESSIONAL_CUSTOMER_TYPES: PROFESSIONAL_CUSTOMER_TYPES,
    REQUESTED_SERVICES: REQUESTED_SERVICES,
    MAX_PARAM_LENGTH: MAX_PARAM_LENGTH,
    sanitizeQueryValue: sanitizeQueryValue,
    isValidResultStatus: isValidResultStatus,
    parseReferralParams: parseReferralParams,
    isDecodeMyItemReferral: isDecodeMyItemReferral,
    getReferralIntroCopy: getReferralIntroCopy,
    isProfessionalCustomerType: isProfessionalCustomerType,
    generateRequestId: generateRequestId
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.AVShared = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
