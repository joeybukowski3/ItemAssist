/**
 * Validation and normalization for the homepage inquiry form ("Request
 * Research or a Free Consultation"). Pure functions only: no network, no environment, so every rule is
 * unit-testable. The browser repeats these checks for convenience, but this
 * module is the authority.
 */

/** What the visitor is asking for. The wire field is still called `reason`. */
const REASONS = {
  consultation: "Free consultation",
  research_request: "Research request / assignment",
  exploring: "Exploring options"
};

const ITEM_COUNT_BANDS = {
  "1-10": "1–10 items",
  "11-50": "11–50 items",
  "51-150": "51–150 items",
  "150+": "More than 150 items",
  not_sure: "Not sure yet"
};

const LIMITS = {
  name: 100,
  email: 254,
  company: 120,
  phone: 40,
  description: 1000,
  sourceToken: 40,
  submissionId: 64
};

const PHONE_CHARS = /^[0-9+().\-\s#xXeEtT]+$/;
const SOURCE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-+ ]{0,39}$/;
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Single-line field: control characters removed, line breaks become spaces. */
function cleanLine(value) {
  return String(value == null ? "" : value)
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Multi-line field: control characters removed, line breaks preserved. */
function cleanText(value) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Digits, spacing and punctuation only, with 7 to 20 digits (an extension may follow). */
function isValidPhone(value) {
  if (typeof value !== "string" || value.length > LIMITS.phone || !PHONE_CHARS.test(value)) {
    return false;
  }
  const digits = (value.match(/\d/g) || []).length;
  return digits >= 7 && digits <= 20;
}

function isValidEmail(value) {
  return (
    typeof value === "string" &&
    value.length <= LIMITS.email &&
    /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(value)
  );
}

/**
 * A marketing-source label is an explicit campaign tag such as the value of
 * utm_source. Anything that does not look like a short tag is dropped
 * instead of stored, so a URL, an email address or free text never lands in
 * a lead record by way of this field.
 */
function cleanSourceToken(value) {
  const token = cleanLine(value);
  if (!token || token.length > LIMITS.sourceToken || !SOURCE_TOKEN_PATTERN.test(token) || token.includes("@")) {
    return "";
  }
  return token;
}

/**
 * @param {Record<string, unknown>} body parsed JSON body
 * @returns {{ fields: object, errors: Record<string,string> }}
 *   fields is the normalized record; errors maps field name to a message and
 *   is empty when the submission is valid.
 */
function validateConsultation(body) {
  const input = body && typeof body === "object" ? body : {};
  const errors = {};

  const name = cleanLine(input.name);
  const email = cleanLine(input.email);
  const reason = cleanLine(input.reason);
  const company = cleanLine(input.company);
  const phone = cleanLine(input.phone);
  const itemCount = cleanLine(input.item_count);
  const description = cleanText(input.description);
  const submissionId = cleanLine(input.submission_id);

  if (!name) {
    errors.name = "Please enter your name.";
  } else if (name.length > LIMITS.name) {
    errors.name = `Please keep your name under ${LIMITS.name} characters.`;
  }

  if (!email) {
    errors.email = "Please enter your email address.";
  } else if (!isValidEmail(email)) {
    errors.email = "Please enter a valid email address.";
  }

  if (!reason) {
    errors.reason = "Please choose a request type.";
  } else if (!Object.prototype.hasOwnProperty.call(REASONS, reason)) {
    errors.reason = "Please choose one of the listed request types.";
  }

  if (company.length > LIMITS.company) {
    errors.company = `Please keep the company name under ${LIMITS.company} characters.`;
  }

  if (phone && !isValidPhone(phone)) {
    errors.phone = "Please enter a phone number such as (555) 555-5555, or leave it blank.";
  }

  if (itemCount && !Object.prototype.hasOwnProperty.call(ITEM_COUNT_BANDS, itemCount)) {
    errors.item_count = "Please choose one of the listed item counts, or leave it blank.";
  }

  if (!description) {
    errors.description = "Please add a short description of what you need.";
  } else if (description.length > LIMITS.description) {
    errors.description = `Please keep the description under ${LIMITS.description} characters.`;
  }

  return {
    errors,
    fields: {
      name,
      email,
      reason,
      company,
      phone,
      itemCount,
      description,
      // An id that is not well formed is ignored: it only guards double-submits.
      submissionId: SUBMISSION_ID_PATTERN.test(submissionId) ? submissionId : "",
      source: {
        source: cleanSourceToken(input.utm_source || input.ref),
        medium: cleanSourceToken(input.utm_medium),
        campaign: cleanSourceToken(input.utm_campaign)
      },
      website: cleanLine(input.website),
      turnstileToken: cleanLine(input.turnstileToken)
    }
  };
}

module.exports = {
  REASONS,
  ITEM_COUNT_BANDS,
  LIMITS,
  cleanLine,
  cleanText,
  cleanSourceToken,
  isValidEmail,
  isValidPhone,
  validateConsultation
};
