function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SERVICE_LABELS = {
  age_verification: "Age Verification",
  item_pricing_valuation: "Item Consultation",
  item_list_collection: "Item List Collection",
  unsure: "Unsure — Help Me Determine the Scope"
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

const INFORMATION_METHOD_LABELS = {
  enter_items_now: "Enter Items Now",
  upload_or_paste_list: "Upload or Paste an Item List",
  list_needs_collection: "Item List Still Needs to Be Collected"
};

function servicesLabel(requestedServices) {
  const list = Array.isArray(requestedServices) ? requestedServices : [];
  if (list.length === 0) {
    return "Not specified";
  }
  return list.map((value) => SERVICE_LABELS[value] || value).join(", ");
}

function customerTypeLabel(customerType) {
  return CUSTOMER_TYPE_LABELS[customerType] || customerType || "Not specified";
}

function informationMethodLabel(informationMethod) {
  return INFORMATION_METHOD_LABELS[informationMethod] || informationMethod || "Not specified";
}

function buildItemRowsHtml(items) {
  return (items || [])
    .map((item, index) => {
      const parts = [
        `Item ${index + 1}: ${item.description || "(no description)"}`,
        item.category,
        item.brand,
        item.model,
        item.noSerial ? "No readable serial number" : item.serial ? `Serial: ${item.serial}` : "",
        item.approximateAge ? `Approx. age: ${item.approximateAge}` : ""
      ]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" &bull; ");

      const research = item.requestedResearch ? `<br><span style="color:#556;">Requested research: ${escapeHtml(item.requestedResearch)}</span>` : "";
      const notes = item.notes ? `<br><span style="color:#556;">${escapeHtml(item.notes)}</span>` : "";

      return `<li>${parts}${research}${notes}</li>`;
    })
    .join("");
}

function buildItemRowsText(items) {
  return (items || [])
    .map((item, index) => {
      const parts = [
        `Item ${index + 1}: ${item.description || "(no description)"}`,
        item.category ? `Category: ${item.category}` : "",
        item.brand ? `Brand: ${item.brand}` : "",
        item.model ? `Model: ${item.model}` : "",
        item.noSerial ? "No readable serial number" : item.serial ? `Serial: ${item.serial}` : "",
        item.approximateAge ? `Approx. age: ${item.approximateAge}` : "",
        item.requestedResearch ? `Requested research: ${item.requestedResearch}` : "",
        item.notes ? `Notes: ${item.notes}` : ""
      ].filter(Boolean);

      return parts.join(" | ");
    })
    .join("\n");
}

function buildItemListSummaryHtml(record) {
  if (record.informationMethod !== "upload_or_paste_list" || !record.itemList) {
    return "";
  }

  const list = record.itemList;
  const source = [
    list.uploadedFiles && list.uploadedFiles.length > 0 ? `${list.uploadedFiles.length} file(s) uploaded` : "",
    list.pastedText ? "item list pasted as text" : "",
    list.willProvideLater ? "client will provide the list after contact" : ""
  ]
    .filter(Boolean)
    .join("; ") || "no list provided yet";

  return `
    <h3>Item List</h3>
    <p>${escapeHtml(source)}</p>
    ${list.estimatedItemCount ? `<p>Estimated item count: ${escapeHtml(list.estimatedItemCount)}</p>` : ""}
    ${list.workInstructions ? `<p>Work instructions: ${escapeHtml(list.workInstructions)}</p>` : ""}
    ${list.pastedText ? `<pre style="white-space:pre-wrap;background:#f4f6fa;padding:10px;border-radius:6px;">${escapeHtml(list.pastedText)}</pre>` : ""}
  `;
}

function buildItemListSummaryText(record) {
  if (record.informationMethod !== "upload_or_paste_list" || !record.itemList) {
    return "";
  }

  const list = record.itemList;
  const lines = [
    "Item List:",
    list.uploadedFiles && list.uploadedFiles.length > 0 ? `${list.uploadedFiles.length} file(s) uploaded` : "",
    list.pastedText ? "Item list pasted as text (see below)" : "",
    list.willProvideLater ? "Client will provide the list after Item Assist contacts them" : "",
    list.estimatedItemCount ? `Estimated item count: ${list.estimatedItemCount}` : "",
    list.workInstructions ? `Work instructions: ${list.workInstructions}` : "",
    list.pastedText ? `\nPasted list:\n${list.pastedText}` : ""
  ].filter(Boolean);

  return lines.join("\n");
}

function buildThirdPartyCollectionSummaryHtml(record) {
  if (record.informationMethod !== "list_needs_collection" || !record.thirdPartyCollection) {
    return "";
  }

  const tp = record.thirdPartyCollection;
  return `
    <h3>Item List Collection Contact</h3>
    <p>${escapeHtml(tp.contactNameOrOrg || "")}${tp.relationship ? ` (${escapeHtml(tp.relationship)})` : ""}<br>
    ${[tp.email, tp.phone].filter(Boolean).map(escapeHtml).join(" &bull; ")}<br>
    Preferred contact: ${escapeHtml(tp.preferredContactMethod || "Not specified")}<br>
    Authorization confirmed: ${tp.authorizationAck ? `Yes (${escapeHtml(tp.authorizationAckAt || "")})` : "No"}</p>
    ${tp.knownCategoriesOrScope ? `<p>Known categories / estimated scope: ${escapeHtml(tp.knownCategoriesOrScope)}</p>` : ""}
    ${tp.contactInstructions ? `<p>Contact instructions: ${escapeHtml(tp.contactInstructions)}</p>` : ""}
  `;
}

function buildThirdPartyCollectionSummaryText(record) {
  if (record.informationMethod !== "list_needs_collection" || !record.thirdPartyCollection) {
    return "";
  }

  const tp = record.thirdPartyCollection;
  return [
    "Item List Collection Contact:",
    tp.contactNameOrOrg,
    tp.relationship ? `Relationship: ${tp.relationship}` : "",
    tp.email ? `Email: ${tp.email}` : "",
    tp.phone ? `Phone: ${tp.phone}` : "",
    `Preferred contact: ${tp.preferredContactMethod || "Not specified"}`,
    `Authorization confirmed: ${tp.authorizationAck ? `Yes (${tp.authorizationAckAt || ""})` : "No"}`,
    tp.knownCategoriesOrScope ? `Known categories / estimated scope: ${tp.knownCategoriesOrScope}` : "",
    tp.contactInstructions ? `Contact instructions: ${tp.contactInstructions}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Builds the internal, operationally complete notification email. This
 * email may include attribution, item detail, and third-party contact
 * information; it must never be sent to the customer.
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

  const subject = `New Work Order Request ${record.requestId} — ${servicesLabel(record.requestedServices)}`;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#10243e;">
      <h2>New work order request: ${escapeHtml(record.requestId)}</h2>
      ${decodeBanner}
      <table style="border-collapse:collapse;width:100%;max-width:720px;">
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Requested services</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          servicesLabel(record.requestedServices)
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Information method</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          informationMethodLabel(record.informationMethod)
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
          record.contact.preferredContactMethod || "Not specified"
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Work order description</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.workOrderDescription
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Claim / reference number</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.claimReference || ""
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Insured / policyholder</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.insuredOrPolicyholderName || ""
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Requested deadline</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.requestedCompletionDate || ""
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Billing / PO notes</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          [record.billing && record.billing.billingContact, record.billing && record.billing.poRequired, record.billing && record.billing.specialReportingRequirements]
            .filter(Boolean)
            .join(" — ")
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Universal acknowledgement confirmed</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          record.authorization.universalAck ? "Yes" : "No"
        )}</td></tr>
        <tr><td style="padding:6px 10px;font-weight:700;border:1px solid #dbe4f0;">Item count</td><td style="padding:6px 10px;border:1px solid #dbe4f0;">${escapeHtml(
          String(record.items.length)
        )}</td></tr>
      </table>
      ${record.items.length > 0 ? `<h3>Items</h3><ul>${buildItemRowsHtml(record.items)}</ul>` : ""}
      ${buildItemListSummaryHtml(record)}
      ${buildThirdPartyCollectionSummaryHtml(record)}
    </div>
  `;

  const text = [
    `New work order request: ${record.requestId}`,
    isDecodeMyItem ? `DecodeMyItem-originated lead — result ID: ${record.attribution.resultId || "n/a"}, status: ${record.attribution.resultStatus || "n/a"}` : "",
    `Requested services: ${servicesLabel(record.requestedServices)}`,
    `Information method: ${informationMethodLabel(record.informationMethod)}`,
    `Customer type: ${customerTypeLabel(record.customerType)}`,
    `Name: ${record.contact.fullName}`,
    `Company: ${record.company || ""}`,
    `Email: ${record.contact.email}`,
    `Phone: ${record.contact.phone}`,
    `Preferred contact: ${record.contact.preferredContactMethod || "Not specified"}`,
    `Work order description: ${record.workOrderDescription}`,
    record.claimReference ? `Claim / reference number: ${record.claimReference}` : "",
    record.insuredOrPolicyholderName ? `Insured / policyholder: ${record.insuredOrPolicyholderName}` : "",
    record.requestedCompletionDate ? `Requested deadline: ${record.requestedCompletionDate}` : "",
    `Universal acknowledgement confirmed: ${record.authorization.universalAck ? "Yes" : "No"}`,
    `Item count: ${record.items.length}`,
    "",
    record.items.length > 0 ? "Items:\n" + buildItemRowsText(record.items) : "",
    buildItemListSummaryText(record),
    buildThirdPartyCollectionSummaryText(record)
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { subject, html, text };
}

/**
 * Builds the minimal customer confirmation email. Must never include
 * operational detail beyond what the customer already submitted, and must
 * never state that the assignment has been accepted, priced, or started.
 *
 * @param {object} record
 * @returns {{subject:string, html:string, text:string}}
 */
function buildCustomerEmail(record) {
  const subject = "Your Item Assist work order request has been received";

  const html = `
    <div style="font-family:Arial,sans-serif;color:#10243e;line-height:1.6;">
      <p>Your Item Assist work order request has been received.</p>
      <p><strong>Request ID:</strong> ${escapeHtml(record.requestId)}<br>
      <strong>Requested services:</strong> ${escapeHtml(servicesLabel(record.requestedServices))}<br>
      <strong>Items submitted:</strong> ${escapeHtml(String(record.items.length))}</p>
      <p>There is no charge to submit a work order. Submission does not authorize paid work. Item Assist will personally review the request and confirm the scope, pricing, turnaround, and next steps before beginning.</p>
      <p>Typical response window: within 1–2 business days.</p>
    </div>
  `;

  const text = [
    "Your Item Assist work order request has been received.",
    `Request ID: ${record.requestId}`,
    `Requested services: ${servicesLabel(record.requestedServices)}`,
    `Items submitted: ${record.items.length}`,
    "",
    "There is no charge to submit a work order. Submission does not authorize paid work. Item Assist will personally review the request and confirm the scope, pricing, turnaround, and next steps before beginning.",
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
 * already notified) but must be logged by the caller. Never sent when the
 * customer did not provide an email address.
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
  servicesLabel,
  customerTypeLabel,
  informationMethodLabel,
  buildInternalEmail,
  buildCustomerEmail,
  sendInternalNotification,
  sendCustomerConfirmation
};
