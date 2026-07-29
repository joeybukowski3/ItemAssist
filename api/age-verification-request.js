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

const RESULT_STATUSES = AVShared.RESULT_STATUSES;
const EXPECTED_RESPONSE_WINDOW = "within 1–2 business days";
const ITEM_FIELD_PATTERN = /^item_(\d+)_(category|brand|model|serial|no_serial|notes|purchase_info)$/;
const SHARED_DOCUMENT_FIELDS = ["shared_document_1", "shared_document_2"];

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(payload));
}

function normalizeField(value) {
  return String(value == null ? "" : value).trim();
}

function extractValidEmail(emailString) {
  const value = normalizeField(emailString);
  return validation.isValidEmail(value) ? value : null;
}

/**
 * Reconstructs the item list from flat multipart/JSON field names like
 * item_3_category, item_3_serial, item_3_no_serial, merging in any files
 * collected under item_3_data_label_photo / item_3_overview_photo.
 *
 * @param {Record<string,string>} fields
 * @param {Record<number,{dataLabelPhoto?: object, overviewPhoto?: object}>} itemFiles
 * @returns {Array<object>}
 */
function buildItemsFromFields(fields, itemFiles) {
  const indices = new Set();

  Object.keys(fields).forEach((key) => {
    const match = key.match(ITEM_FIELD_PATTERN);
    if (match) {
      indices.add(Number(match[1]));
    }
  });

  Object.keys(itemFiles || {}).forEach((key) => indices.add(Number(key)));

  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((index) => ({
      category: normalizeField(fields[`item_${index}_category`]),
      brand: normalizeField(fields[`item_${index}_brand`]),
      model: normalizeField(fields[`item_${index}_model`]),
      serial: normalizeField(fields[`item_${index}_serial`]),
      noSerial: Boolean(fields[`item_${index}_no_serial`]),
      notes: normalizeField(fields[`item_${index}_notes`]),
      purchaseInfo: normalizeField(fields[`item_${index}_purchase_info`]),
      files: {
        dataLabelPhoto: (itemFiles && itemFiles[index] && itemFiles[index].dataLabelPhoto) || null,
        overviewPhoto: (itemFiles && itemFiles[index] && itemFiles[index].overviewPhoto) || null
      }
    }));
}

function parseJsonBody(body) {
  const fields = {};
  Object.keys(body || {}).forEach((key) => {
    if (typeof body[key] === "string" || typeof body[key] === "boolean" || typeof body[key] === "number") {
      fields[key] = body[key];
    }
  });

  return { fields, itemFiles: {}, sharedDocuments: [], fileBuffers: [] };
}

function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const itemFiles = {};
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
        fields: 60
      }
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, stream, info) => {
      const isSharedDocument = SHARED_DOCUMENT_FIELDS.includes(name);
      const itemFileMatch = name.match(/^item_(\d+)_(data_label_photo|overview_photo)$/);

      if (!isSharedDocument && !itemFileMatch) {
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
        parseError = "Only JPG, JPEG, PNG, and PDF files are accepted.";
      }

      fileCount += 1;
      if (fileCount > files.MAX_FILE_COUNT) {
        parseError = `Please attach no more than ${files.MAX_FILE_COUNT} files in total.`;
      }

      const chunks = [];
      let size = 0;

      stream.on("limit", () => {
        parseError = `Each file must be ${Math.round(files.MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB or smaller.`;
      });

      stream.on("data", (chunk) => {
        size += chunk.length;
        totalBytes += chunk.length;

        if (!parseError && totalBytes > files.MAX_TOTAL_BYTES) {
          parseError = `Total attachment size must be ${Math.round(files.MAX_TOTAL_BYTES / (1024 * 1024))}MB or smaller.`;
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

        if (isSharedDocument) {
          sharedDocuments.push(fileMeta);
        } else if (itemFileMatch) {
          const index = Number(itemFileMatch[1]);
          const slot = itemFileMatch[2] === "data_label_photo" ? "dataLabelPhoto" : "overviewPhoto";
          itemFiles[index] = itemFiles[index] || {};
          itemFiles[index][slot] = fileMeta;
        }
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

      resolve({ fields, itemFiles, sharedDocuments, fileBuffers });
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
    selectedService: normalizeField(fields.requested_service),
    reasonForRequest: normalizeField(fields.reason_for_request),
    claimReference: normalizeField(fields.claim_reference),
    requestedCompletionDate: normalizeField(fields.requested_completion_date),
    billing: {
      billingContact: normalizeField(fields.billing_contact),
      poRequired: normalizeField(fields.po_required),
      specialReportingRequirements: normalizeField(fields.special_reporting_requirements)
    },
    authorizationAck: Boolean(fields.authorization_ack),
    limitationsAck: Boolean(fields.limitations_ack),
    items,
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
 * Builds the age-verification-request handler with all external clients
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

    const { fields, itemFiles, sharedDocuments, fileBuffers } = parsed;

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

    const items = buildItemsFromFields(fields, itemFiles);
    const submission = buildSubmission(fields, items, sharedDocuments);

    const contactErrors = validation.validateContactFields({
      fullName: submission.contact.fullName,
      email: submission.contact.email,
      phone: submission.contact.phone,
      customerType: submission.customerType,
      preferredContactMethod: submission.contact.preferredContactMethod,
      company: submission.company,
      requestedService: submission.selectedService,
      reasonForRequest: submission.reasonForRequest,
      authorizationAck: submission.authorizationAck,
      limitationsAck: submission.limitationsAck
    });
    const itemErrors = validation.validateItems(items);

    if (contactErrors.length > 0 || itemErrors.length > 0) {
      return json(res, 400, { ok: false, error: contactErrors.concat(itemErrors)[0], errors: contactErrors.concat(itemErrors) });
    }

    const allFileMeta = items
      .flatMap((item) => [item.files.dataLabelPhoto, item.files.overviewPhoto])
      .filter(Boolean)
      .concat(sharedDocuments);
    const fileError = files.validateUploadSet(allFileMeta, sharedDocuments);

    if (fileError) {
      return json(res, 400, { ok: false, error: fileError });
    }

    const submitterEmail = extractValidEmail(submission.contact.email);
    if (!submitterEmail) {
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

    const record = {
      requestId,
      status: "submitted",
      createdAt: timestamp,
      updatedAt: timestamp,
      customerType: submission.customerType,
      contact: submission.contact,
      company: submission.company,
      selectedService: submission.selectedService,
      reasonForRequest: submission.reasonForRequest,
      items: items.map((item) => ({
        category: item.category,
        brand: item.brand,
        model: item.model,
        serial: item.noSerial ? "" : item.serial,
        noSerial: item.noSerial,
        notes: item.notes,
        purchaseInfo: item.purchaseInfo,
        files: item.files
      })),
      claimReference: submission.claimReference,
      requestedCompletionDate: submission.requestedCompletionDate,
      billing: submission.billing,
      attribution: submission.attribution,
      sharedDocuments,
      authorization: {
        authorizationAck: submission.authorizationAck,
        limitationsAck: submission.limitationsAck
      },
      submissionMeta: {
        itemCount: items.length,
        fileCount: allFileMeta.length,
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

    try {
      await sendCustomerConfirmation(resend, record, { fromEmail });
    } catch (error) {
      logError("age-verification-request customer confirmation failed", requestId, error.message);
    }

    return json(res, 200, {
      ok: true,
      requestId,
      selectedService: record.selectedService,
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
