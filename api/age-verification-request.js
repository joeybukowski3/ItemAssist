const Busboy = require("busboy");
const { Resend } = require("resend");

const { generateRequestId } = require("./lib/age-verification/request-id");
const validation = require("./lib/age-verification/validation");
const files = require("./lib/age-verification/files");
const { saveRequestRecord } = require("./lib/age-verification/store");
const { checkRateLimit } = require("./lib/age-verification/ratelimit");
const { verifyTurnstile } = require("./lib/age-verification/turnstile");
const { sendInternalNotification, sendCustomerConfirmation } = require("./lib/age-verification/email");
const AVShared = require("../assets/js/av-shared.js");
const AVFileRules = require("../assets/js/av-file-rules.js");

const RESULT_STATUSES = AVShared.RESULT_STATUSES;
const EXPECTED_RESPONSE_WINDOW = "within 1–2 business days";
const ITEM_FIELD_PATTERN = /^item_(\d+)_(description|category|brand|model|serial|no_serial|approximate_age|requested_research|notes)$/;
const SHARED_DOCUMENT_FIELDS = ["shared_document_1", "shared_document_2"];
const MULTI_VALUE_FIELDS = new Set(["requested_services"]);
const MAX_PASTED_LIST_LENGTH = AVShared.MAX_PASTED_LIST_LENGTH;

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(payload));
}

function normalizeField(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeRequestedServices(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(normalizeField).filter(Boolean);
}

function extractValidEmail(emailString) {
  const value = normalizeField(emailString);
  return validation.isValidEmail(value) ? value : null;
}

/**
 * Reconstructs the item list from flat multipart/JSON field names like
 * item_3_description, item_3_category, item_3_serial, item_3_no_serial.
 * Files are never per-item in this architecture — all uploads share one
 * capped pool (see SHARED_DOCUMENT_FIELDS) that stays well under Vercel's
 * fixed request-body limit.
 *
 * @param {Record<string,string>} fields
 * @returns {Array<object>}
 */
function buildItemsFromFields(fields) {
  const indices = new Set();

  Object.keys(fields).forEach((key) => {
    const match = key.match(ITEM_FIELD_PATTERN);
    if (match) {
      indices.add(Number(match[1]));
    }
  });

  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((index) => ({
      description: normalizeField(fields[`item_${index}_description`]),
      category: normalizeField(fields[`item_${index}_category`]),
      brand: normalizeField(fields[`item_${index}_brand`]),
      model: normalizeField(fields[`item_${index}_model`]),
      serial: normalizeField(fields[`item_${index}_serial`]),
      noSerial: Boolean(fields[`item_${index}_no_serial`]),
      approximateAge: normalizeField(fields[`item_${index}_approximate_age`]),
      requestedResearch: normalizeField(fields[`item_${index}_requested_research`]),
      notes: normalizeField(fields[`item_${index}_notes`])
    }));
}

function parseJsonBody(body) {
  const fields = {};
  Object.keys(body || {}).forEach((key) => {
    const value = body[key];
    if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
      fields[key] = value;
    } else if (Array.isArray(value) && MULTI_VALUE_FIELDS.has(key)) {
      fields[key] = value.filter((entry) => typeof entry === "string");
    }
  });

  return { fields, sharedDocuments: [], fileBuffers: [] };
}

function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const sharedDocuments = [];
    const fileBuffers = [];
    let totalBytes = 0;
    let fileCount = 0;
    let parseError = null;

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: files.MAX_FILE_COUNT,
        fileSize: files.MAX_FILE_SIZE_BYTES,
        fields: 80
      }
    });

    busboy.on("field", (name, value) => {
      if (MULTI_VALUE_FIELDS.has(name)) {
        fields[name] = fields[name] || [];
        fields[name].push(value);
      } else {
        fields[name] = value;
      }
    });

    busboy.on("file", (name, stream, info) => {
      const isSharedDocument = SHARED_DOCUMENT_FIELDS.includes(name);

      if (!isSharedDocument) {
        stream.resume();
        return;
      }

      const rawFilename = info && info.filename ? info.filename : "";
      if (!rawFilename) {
        stream.resume();
        return;
      }

      const filename = files.sanitizeFilename(rawFilename);
      const mimeType = String(info && info.mimeType ? info.mimeType : "").toLowerCase();

      if (!files.isAllowedAttachment(filename, mimeType)) {
        parseError = `Only ${AVFileRules.ALLOWED_TYPES_SUMMARY} files are accepted.`;
      }

      fileCount += 1;
      if (fileCount > files.MAX_FILE_COUNT) {
        parseError = `Please attach no more than ${files.MAX_FILE_COUNT} files in total.`;
      }

      const chunks = [];
      let size = 0;

      stream.on("limit", () => {
        parseError = `Each file must be ${AVFileRules.formatMB(files.MAX_FILE_SIZE_BYTES)}MB or smaller.`;
      });

      stream.on("data", (chunk) => {
        size += chunk.length;
        totalBytes += chunk.length;

        if (!parseError && totalBytes > files.MAX_TOTAL_BYTES) {
          parseError = `Total attachment size must be ${AVFileRules.formatMB(files.MAX_TOTAL_BYTES)}MB or smaller.`;
        }

        if (!parseError) {
          chunks.push(chunk);
        }
      });

      stream.on("end", () => {
        if (parseError) {
          return;
        }

        const fileMeta = { filename, mimeType: mimeType || "application/octet-stream", size };
        const buffer = Buffer.concat(chunks);
        fileBuffers.push({ filename, buffer });
        sharedDocuments.push(fileMeta);
      });
    });

    busboy.on("filesLimit", () => {
      parseError = `Please attach no more than ${files.MAX_FILE_COUNT} files in total.`;
    });

    busboy.on("error", (error) => reject(error));

    busboy.on("close", () => {
      if (parseError) {
        reject(new Error(parseError));
        return;
      }

      resolve({ fields, sharedDocuments, fileBuffers });
    });

    req.pipe(busboy);
  });
}

function getContentType(req) {
  return String(req.headers["content-type"] || "").toLowerCase();
}

async function parseRequest(req) {
  const contentType = getContentType(req);

  if (contentType.includes("multipart/form-data")) {
    return parseMultipartForm(req);
  }

  const body = typeof req.body === "object" && req.body !== null ? req.body : {};
  return parseJsonBody(body);
}

function buildSubmission(fields, items, sharedDocuments) {
  const referral = AVShared.parseReferralParams({
    get: (key) => fields[key] || null
  });

  return {
    customerType: normalizeField(fields.customer_type),
    contact: {
      fullName: normalizeField(fields.full_name),
      email: normalizeField(fields.email),
      phone: normalizeField(fields.phone),
      preferredContactMethod: normalizeField(fields.preferred_contact_method)
    },
    company: normalizeField(fields.company),
    insuredOrPolicyholderName: normalizeField(fields.insured_or_policyholder_name),
    requestedServices: normalizeRequestedServices(fields.requested_services),
    workOrderDescription: normalizeField(fields.work_order_description),
    informationMethod: normalizeField(fields.information_method),
    items,
    itemList: {
      pastedText: normalizeField(fields.pasted_item_list).slice(0, MAX_PASTED_LIST_LENGTH),
      estimatedItemCount: normalizeField(fields.estimated_item_count),
      workInstructions: normalizeField(fields.work_instructions),
      willProvideLater: Boolean(fields.will_provide_list_later)
    },
    thirdPartyCollection: {
      contactNameOrOrg: normalizeField(fields.third_party_contact_name),
      phone: normalizeField(fields.third_party_phone),
      email: normalizeField(fields.third_party_email),
      relationship: normalizeField(fields.third_party_relationship),
      preferredContactMethod: normalizeField(fields.third_party_preferred_contact_method),
      contactInstructions: normalizeField(fields.third_party_contact_instructions),
      knownCategoriesOrScope: normalizeField(fields.third_party_known_scope),
      authorizationAck: Boolean(fields.third_party_authorization_ack)
    },
    claimReference: normalizeField(fields.claim_reference),
    requestedCompletionDate: normalizeField(fields.requested_completion_date),
    billing: {
      billingContact: normalizeField(fields.billing_contact),
      poRequired: normalizeField(fields.po_required),
      specialReportingRequirements: normalizeField(fields.special_reporting_requirements)
    },
    universalAck: Boolean(fields.universal_ack),
    ageVerificationLimitationsAck: Boolean(fields.limitations_ack),
    sharedDocuments,
    attribution: {
      source: referral.source || "",
      resultId: referral.resultId || "",
      resultStatus: RESULT_STATUSES.indexOf(referral.resultStatus) !== -1 ? referral.resultStatus : ""
    },
    website: normalizeField(fields.website),
    turnstileToken: normalizeField(fields.turnstileToken)
  };
}

/**
 * Builds the work-order-request handler with all external clients
 * injectable, so tests can exercise the full request lifecycle (parsing,
 * validation, rate limiting, Turnstile, persistence, email) against fakes
 * with no live network calls.
 *
 * @param {object} [overrides]
 * @param {import("@upstash/redis").Redis} [overrides.redis]
 * @param {{limit: Function}} [overrides.ratelimit]
 * @param {{emails:{send:Function}}} [overrides.resend]
 * @param {Function} [overrides.verifyTurnstile]
 * @param {Function} [overrides.now]
 * @param {Function} [overrides.generateRequestId]
 * @param {(...args:any[])=>void} [overrides.logError]
 */
function createHandler(overrides = {}) {
  const now = overrides.now || (() => new Date());
  const makeRequestId = overrides.generateRequestId || generateRequestId;
  const logError = overrides.logError || ((...args) => console.error(...args));
  const doVerifyTurnstile = overrides.verifyTurnstile || verifyTurnstile;

  return async function handler(req, res) {
    if (req.method === "GET") {
      const siteKey = process.env.TURNSTILE_SITE_KEY;

      if (!siteKey) {
        return json(res, 500, { error: "Turnstile is not configured." });
      }

      return json(res, 200, { turnstileSiteKey: siteKey });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, error: "Method not allowed." });
    }

    const resend = overrides.resend || (process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null);
    const fromEmail = process.env.CONTACT_FROM_EMAIL || "";
    const toEmail = process.env.PROFESSIONAL_REQUEST_TO_EMAIL || process.env.CONTACT_TO_EMAIL || "";

    if (!resend || !toEmail || !fromEmail || !(overrides.turnstileSecretKey || process.env.TURNSTILE_SECRET_KEY)) {
      return json(res, 500, { ok: false, error: "This form is not configured yet." });
    }

    let parsed;
    try {
      parsed = await parseRequest(req);
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message || "One or more attachments could not be processed." });
    }

    const { fields, sharedDocuments, fileBuffers } = parsed;

    if (normalizeField(fields.website)) {
      return json(res, 200, { ok: true, message: "Request received." });
    }

    const remoteIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    const rateLimitResult = await checkRateLimit(String(remoteIp).split(",")[0].trim(), {
      ratelimit: overrides.ratelimit
    }).catch((error) => {
      logError("age-verification-request rate limit check failed", error.message);
      return { success: true };
    });

    if (!rateLimitResult.success) {
      return json(res, 429, { ok: false, error: "Too many requests. Please try again in a few minutes." });
    }

    const items = buildItemsFromFields(fields);
    const submission = buildSubmission(fields, items, sharedDocuments);

    const contactErrors = validation.validateContactFields({
      fullName: submission.contact.fullName,
      email: submission.contact.email,
      phone: submission.contact.phone,
      customerType: submission.customerType,
      preferredContactMethod: submission.contact.preferredContactMethod,
      company: submission.company,
      requestedServices: submission.requestedServices,
      informationMethod: submission.informationMethod,
      workOrderDescription: submission.workOrderDescription,
      universalAck: submission.universalAck,
      ageVerificationLimitationsAck: submission.ageVerificationLimitationsAck
    });

    const pathErrors = validation.validateInformationMethodPath(submission.informationMethod, {
      items,
      itemList: {
        hasUploadedFile: sharedDocuments.length > 0,
        pastedText: submission.itemList.pastedText,
        willProvideLater: submission.itemList.willProvideLater
      },
      thirdPartyCollection: submission.thirdPartyCollection
    });

    if (contactErrors.length > 0 || pathErrors.length > 0) {
      return json(res, 400, { ok: false, error: contactErrors.concat(pathErrors)[0], errors: contactErrors.concat(pathErrors) });
    }

    const fileError = files.validateUploadSet(sharedDocuments, sharedDocuments);

    if (fileError) {
      return json(res, 400, { ok: false, error: fileError });
    }

    const submitterEmail = extractValidEmail(submission.contact.email);
    if (submission.contact.email && !submitterEmail) {
      return json(res, 400, { ok: false, error: "Please enter a valid email address." });
    }

    if (!submission.turnstileToken) {
      return json(res, 400, { ok: false, error: "Please complete the spam protection check." });
    }

    let turnstileResult;
    try {
      turnstileResult = await doVerifyTurnstile(submission.turnstileToken, remoteIp, {
        secretKey: overrides.turnstileSecretKey
      });
    } catch (error) {
      logError("age-verification-request turnstile verification error", error.message);
      return json(res, 500, { ok: false, error: "We couldn't verify spam protection. Please try again." });
    }

    if (!turnstileResult || !turnstileResult.success) {
      return json(res, 400, { ok: false, error: "Spam protection verification failed. Please try again." });
    }

    const requestId = makeRequestId(now());
    const timestamp = now().toISOString();
    const requiresAvAck = validation.requiresAgeVerificationLimitationsAck(submission.requestedServices);
    const isCollectionPath = submission.informationMethod === "list_needs_collection";
    const isUploadPastePath = submission.informationMethod === "upload_or_paste_list";

    const record = {
      requestId,
      schemaVersion: 2,
      status: "submitted",
      pricingScopeStatus: "pending_review",
      createdAt: timestamp,
      updatedAt: timestamp,
      customerType: submission.customerType,
      contact: submission.contact,
      company: submission.company,
      insuredOrPolicyholderName: submission.insuredOrPolicyholderName,
      requestedServices: submission.requestedServices,
      workOrderDescription: submission.workOrderDescription,
      informationMethod: submission.informationMethod,
      items: items.map((item) => ({
        description: item.description,
        category: item.category,
        brand: item.brand,
        model: item.model,
        serial: item.noSerial ? "" : item.serial,
        noSerial: item.noSerial,
        approximateAge: item.approximateAge,
        requestedResearch: item.requestedResearch,
        notes: item.notes
      })),
      itemList: isUploadPastePath
        ? {
            pastedText: submission.itemList.pastedText,
            estimatedItemCount: submission.itemList.estimatedItemCount,
            workInstructions: submission.itemList.workInstructions,
            willProvideLater: submission.itemList.willProvideLater,
            uploadedFiles: sharedDocuments
          }
        : null,
      thirdPartyCollection: isCollectionPath
        ? {
            contactNameOrOrg: submission.thirdPartyCollection.contactNameOrOrg,
            phone: submission.thirdPartyCollection.phone,
            email: submission.thirdPartyCollection.email,
            relationship: submission.thirdPartyCollection.relationship,
            preferredContactMethod: submission.thirdPartyCollection.preferredContactMethod,
            contactInstructions: submission.thirdPartyCollection.contactInstructions,
            knownCategoriesOrScope: submission.thirdPartyCollection.knownCategoriesOrScope,
            authorizationAck: submission.thirdPartyCollection.authorizationAck,
            authorizationAckAt: submission.thirdPartyCollection.authorizationAck ? timestamp : null
          }
        : null,
      claimReference: submission.claimReference,
      requestedCompletionDate: submission.requestedCompletionDate,
      billing: submission.billing,
      attribution: submission.attribution,
      sharedDocuments,
      authorization: {
        universalAck: submission.universalAck,
        ageVerificationLimitationsAck: requiresAvAck ? submission.ageVerificationLimitationsAck : null,
        thirdPartyContactAck: isCollectionPath ? submission.thirdPartyCollection.authorizationAck : null
      },
      submissionMeta: {
        informationMethod: submission.informationMethod,
        itemCount: items.length,
        hasPastedList: Boolean(submission.itemList.pastedText),
        hasUploadedList: isUploadPastePath && sharedDocuments.length > 0,
        willProvideListLater: submission.itemList.willProvideLater,
        thirdPartyCollectionRequested: isCollectionPath,
        fileCount: sharedDocuments.length,
        totalFileBytes: sharedDocuments.reduce((sum, file) => sum + (file.size || 0), 0),
        userAgent: normalizeField(req.headers["user-agent"]),
        submittedAt: timestamp
      }
    };

    try {
      await saveRequestRecord(record, { redis: overrides.redis });
    } catch (error) {
      logError("age-verification-request persistence failed", requestId, error.message);
      return json(res, 503, {
        ok: false,
        error: "We couldn't save your request. Please try again in a moment.",
        retryable: true
      });
    }

    try {
      await sendInternalNotification(resend, record, fileBuffers, { fromEmail, toEmail });
    } catch (error) {
      logError("age-verification-request internal notification failed", requestId, error.message);
      return json(res, 502, {
        ok: false,
        error: "Your request was saved, but we couldn't send the internal notification. Our team will follow up.",
        requestId
      });
    }

    if (record.contact.email) {
      try {
        await sendCustomerConfirmation(resend, record, { fromEmail });
      } catch (error) {
        logError("age-verification-request customer confirmation failed", requestId, error.message);
      }
    }

    return json(res, 200, {
      ok: true,
      requestId,
      requestedServices: record.requestedServices,
      itemCount: items.length,
      contactEmail: record.contact.email,
      expectedResponseWindow: EXPECTED_RESPONSE_WINDOW
    });
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.buildItemsFromFields = buildItemsFromFields;
module.exports.buildSubmission = buildSubmission;
