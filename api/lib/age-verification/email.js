function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SERVICE_LABELS = {
  age_verification: "Professional Age Verification",
  full_valuation: "Full Item Valuation Report",
  unsure: "Unsure — Help Me Choose"
};

const CUSTOMER_TYPE_LABELS = {
  insurance_carrier: "Insurance carrier",
  insurance_adjuster: "Insurance adjuster",
  independent_adjuster: "Independent adjuster",
  restoration_or_claims_vendor: "Restoration or claims vendor",
  property_manager: "Property manager",
  repair_professional: "Repair professional",
  homeowner_or_consumer: "Homeowner or consumer",
  other: "Other"
};

function serviceLabel(service) {
  return SERVICE_LABELS[service] || service || "Not specified";
}

function customerTypeLabel(customerType) {
  return CUSTOMER_TYPE_LABELS[customerType] || customerType || "Not specified";
}

function buildItemRowsHtml(items) {
  return (items || [])
    .map((item, index) => {
      const parts = [
        `Item ${index + 1}`,
        item.category,
        item.brand,
        item.model,
        item.noSerial ? "No readable serial number" : item.serial ? `Serial: ${item.serial}` : ""
      ]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" &bull; ");

      const filesLine = [
        item.files && item.files.dataLabelPhoto ? "data-label photo attached" : "",
        item.files && item.files.overviewPhoto ? "overview photo attached" : ""
      ]
        .filter(Boolean)
        .join(", ");

      const notes = item.notes ? `<br><span style="color:#556;">${escapeHtml(item.notes)}</span>` : "";
      const files = filesLine ? `<br><span style="color:#889;">${escapeHtml(filesLine)}</span>` : "";

      return `<li>${parts}${notes}${files}</li>`;
    })
    .join("");
}

function buildItemRowsText(items) {
  return (items || [])
    .map((item, index) => {
      const parts = [
        `Item ${index + 1}: ${item.category || "(no category)"}`,
        item.brand ? `Brand: ${item.brand}` : "",
        item.model ? `Model: ${item.model}` : "",
        item.noSerial ? "No readable serial number" : item.serial ? `Serial: ${item.serial}` : "",
        item.notes ? `Notes: ${item.notes}` : ""
      ].filter(Boolean);

      return parts.join(" | ");
    })
    .join("\n");
}

/**
 * Builds the internal, operationally complete notification email. This
 * email may include attribution and item detail; it must never be sent to
 * the customer.
 *
 * @param {object} record a stored request record (see store.js)
 * @returns {{subject:string, html:string, text:string}}
 */
function buildInternalEmail(record) {
  const isDecodeMyItem = record.attribution && record.attribution.source === "decodemyitem";
  const decodeBanner = isDecodeMyItem
    ? `<p style="background:#eef4ff;padding:8px 12px;border-radius:6px;"><strong>DecodeMyItem-originated lead</strong> &mdash; result ID: ${escapeHtml(
        record.attribution.resultId || "n/a"
      )}, status: ${escapeHtml(record.attribution.resultStatus || "n/a")}</p>`
    : "";

  const subject = `New Professional Request ${record.requestId} — ${serviceLabel(record.selectedService)}`;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#10243e;">
      <h2>New professional request: ${escapeHtml(record.requestId)}</h2>
      ${decodeBanner}
      <table style="border-collapse:collapse;width:100%;max-width:720px;">
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Requested service</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          serviceLabel(record.selectedService)
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Customer type</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          customerTypeLabel(record.customerType)
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Name</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.contact.fullName
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Company</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.company || ""
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Email</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.contact.email
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Phone</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.contact.phone
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Preferred contact</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.contact.preferredContactMethod
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Reason for request</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.reasonForRequest
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Claim / reference number</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.claimReference || ""
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Requested completion date</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.requestedCompletionDate || ""
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Billing / PO notes</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          [record.billing && record.billing.billingContact, record.billing && record.billing.poRequired, record.billing && record.billing.specialReportingRequirements]
            .filter(Boolean)
            .join(" — ")
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Item count</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          String(record.items.length)
        )}</td></tr>
      </table>
      <h3>Items</h3>
      <ul>${buildItemRowsHtml(record.items)}</ul>
    </div>
  `;

  const text = [
    `New professional request: ${record.requestId}`,
    isDecodeMyItem ? `DecodeMyItem-originated lead — result ID: ${record.attribution.resultId || "n/a"}, status: ${record.attribution.resultStatus || "n/a"}` : "",
    `Requested service: ${serviceLabel(record.selectedService)}`,
    `Customer type: ${customerTypeLabel(record.customerType)}`,
    `Name: ${record.contact.fullName}`,
    `Company: ${record.company || ""}`,
    `Email: ${record.contact.email}`,
    `Phone: ${record.contact.phone}`,
    `Preferred contact: ${record.contact.preferredContactMethod}`,
    `Reason for request: ${record.reasonForRequest}`,
    record.claimReference ? `Claim / reference number: ${record.claimReference}` : "",
    record.requestedCompletionDate ? `Requested completion date: ${record.requestedCompletionDate}` : "",
    `Item count: ${record.items.length}`,
    "",
    "Items:",
    buildItemRowsText(record.items)
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { subject, html, text };
}

/**
 * Builds the minimal customer confirmation email. Must never include
 * operational detail beyond what the customer already submitted.
 *
 * @param {object} record
 * @returns {{subject:string, html:string, text:string}}
 */
function buildCustomerEmail(record) {
  const subject = "Your Item Assist professional request has been received";

  const html = `
    <div style="font-family:Arial,sans-serif;color:#10243e;line-height:1.6;">
      <p>Your Item Assist request has been received.</p>
      <p><strong>Request ID:</strong> ${escapeHtml(record.requestId)}<br>
      <strong>Selected service:</strong> ${escapeHtml(serviceLabel(record.selectedService))}<br>
      <strong>Items submitted:</strong> ${escapeHtml(String(record.items.length))}</p>
      <p>Item Assist will review the submitted information and contact you to confirm scope, pricing, turnaround, and authorization before beginning any paid research.</p>
      <p>Typical response window: within 1–2 business days.</p>
    </div>
  `;

  const text = [
    "Your Item Assist request has been received.",
    `Request ID: ${record.requestId}`,
    `Selected service: ${serviceLabel(record.selectedService)}`,
    `Items submitted: ${record.items.length}`,
    "",
    "Item Assist will review the submitted information and contact you to confirm scope, pricing, turnaround, and authorization before beginning any paid research.",
    "Typical response window: within 1-2 business days."
  ].join("\n");

  return { subject, html, text };
}

/**
 * Sends the internal notification email with file attachments. Throws on
 * failure so the caller can return a retryable error — a request that made
 * it into Redis but never notified the team should not silently succeed.
 *
 * @param {{send: Function}} resend an @resend client (or fake in tests)
 * @param {object} record
 * @param {Array<{filename:string, buffer:Buffer}>} attachments
 * @param {{fromEmail:string, toEmail:string}} addresses
 */
async function sendInternalNotification(resend, record, attachments, addresses) {
  const email = buildInternalEmail(record);

  await resend.emails.send({
    from: addresses.fromEmail,
    to: [addresses.toEmail],
    replyTo: record.contact.email || undefined,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: (attachments || []).map((file) => ({
      filename: file.filename,
      content: file.buffer.toString("base64")
    }))
  });
}

/**
 * Sends the customer confirmation email. Failures are non-fatal to the
 * overall submission (the request is already durably stored and the team
 * already notified) but must be logged by the caller.
 *
 * @param {{send: Function}} resend
 * @param {object} record
 * @param {{fromEmail:string}} addresses
 */
async function sendCustomerConfirmation(resend, record, addresses) {
  const email = buildCustomerEmail(record);

  await resend.emails.send({
    from: addresses.fromEmail,
    to: [record.contact.email],
    subject: email.subject,
    html: email.html,
    text: email.text
  });
}

module.exports = {
  escapeHtml,
  serviceLabel,
  customerTypeLabel,
  buildInternalEmail,
  buildCustomerEmail,
  sendInternalNotification,
  sendCustomerConfirmation
};
