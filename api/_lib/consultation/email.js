const { REASONS, ITEM_COUNT_BANDS } = require("./validation");

/**
 * What each request type changes in the notification. Everything here is fixed
 * text chosen by the server from the validated request type: nothing the visitor
 * typed ever reaches the subject line, a header or a tag.
 */
const REQUEST_PROFILES = {
  consultation: {
    leadType: "consultation_inquiry",
    idPrefix: "CI",
    subjectLabel: "New Consultation Request",
    badge: "Free consultation request &middot; marketing lead",
    heading: "New Item Assist consultation request",
    textBanner: "FREE CONSULTATION REQUEST (marketing lead) - not an assignment submission.",
    summary: "The sender asked for a free consultation to talk through scope. Nothing has been quoted or agreed.",
    nextStep: "Follow up to discuss scope, turnaround, and pricing."
  },
  research_request: {
    leadType: "research_request",
    idPrefix: "RR",
    subjectLabel: "New Research Request",
    badge: "Research request &middot; ready to submit work",
    heading: "New Item Assist research request",
    textBanner: "RESEARCH REQUEST / ASSIGNMENT INQUIRY - the sender says they are ready to submit work.",
    summary: "The sender wants to submit a research assignment. This is first contact only: no scope, price, or files have been agreed or received.",
    nextStep: "Reply to confirm scope, turnaround, and price, and to arrange how the item list or files will be sent."
  },
  exploring: {
    leadType: "exploring_inquiry",
    idPrefix: "EI",
    subjectLabel: "New Inquiry (Exploring Options)",
    badge: "Exploring options &middot; early-stage inquiry",
    heading: "New Item Assist inquiry (exploring options)",
    textBanner: "INQUIRY - the sender is exploring options (marketing lead).",
    summary: "The sender is still exploring whether and how Item Assist can help.",
    nextStep: "Reply with an overview of the service and offer a free consultation."
  },
  human_research: {
    leadType: "human_research_request",
    idPrefix: "HR",
    subjectLabel: "New Human-Reviewed Research Request",
    badge: "Human-reviewed research request &middot; research site",
    heading: "New Item Assist human-reviewed research request",
    textBanner: "HUMAN-REVIEWED RESEARCH REQUEST - the sender wants a person to review or research an item.",
    summary: "The sender asked for human-reviewed research. This is first contact only: no scope, price, or files have been agreed or received.",
    nextStep: "Reply to confirm which items need research, the scope, turnaround, and price."
  },
  paid_access: {
    leadType: "paid_access_inquiry",
    idPrefix: "PA",
    subjectLabel: "New Additional / Paid Access Inquiry",
    badge: "Additional or paid access inquiry &middot; research site",
    heading: "New Item Assist additional or paid access inquiry",
    textBanner: "ADDITIONAL / PAID ACCESS INQUIRY - the sender is asking about access beyond the free research limits.",
    summary: "The sender asked about additional or paid access to the research workspace. Paid access is not available for self-serve purchase, and nothing has been quoted or agreed.",
    nextStep: "Reply to learn how they would use it (volume, frequency) and whether access can be offered."
  },
  general_question: {
    leadType: "general_question",
    idPrefix: "GQ",
    subjectLabel: "New General Question",
    badge: "General question &middot; research site",
    heading: "New Item Assist general question",
    textBanner: "GENERAL QUESTION - website message.",
    summary: "The sender sent a general question through the website.",
    nextStep: "Reply directly to the sender."
  }
};

/** Log label for events raised before a request type is known (spam checks, rate limits). */
const GENERIC_LEAD_TYPE = "website_inquiry";

function profileFor(reason) {
  return Object.prototype.hasOwnProperty.call(REQUEST_PROFILES, reason) ? REQUEST_PROFILES[reason] : REQUEST_PROFILES.consultation;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sourceLabel(source) {
  const parts = [
    source.source && `source: ${source.source}`,
    source.medium && `medium: ${source.medium}`,
    source.campaign && `campaign: ${source.campaign}`
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Not provided (direct or untagged visit)";
}

/** Ordered label/value pairs shared by the HTML and plain-text bodies; blank values are left out. */
function detailRows(fields) {
  const rows = [
    ["Request type", REASONS[fields.reason] || fields.reason],
    ["Name", fields.name],
    ["Email", fields.email],
    ["Company", fields.company],
    ["Phone", fields.phone],
    ["Approximate item count", fields.itemCount && (ITEM_COUNT_BANDS[fields.itemCount] || fields.itemCount)],
    ["Short description", fields.description],
    ["Marketing source", sourceLabel(fields.source)]
  ];
  return rows.filter(([, value]) => Boolean(value));
}

/**
 * Builds the internal notification for a homepage inquiry. The subject is a
 * fixed label for the request type plus the server-generated lead id. Every
 * value in the body is escaped.
 *
 * @param {object} fields normalized fields from validateConsultation
 * @param {{leadId: string, receivedAt: string}} meta
 * @returns {{subject: string, html: string, text: string, tags: Array<{name: string, value: string}>}}
 */
function buildInternalNotification(fields, meta) {
  const profile = profileFor(fields.reason);
  const rows = detailRows(fields);

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px;font-weight:700;vertical-align:top;border:1px solid #dbe4f0;">${escapeHtml(label)}</td><td style="padding:8px 12px;vertical-align:top;border:1px solid #dbe4f0;">${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`
    )
    .join("");

  const html = `
      <div style="font-family:Arial,sans-serif;color:#10243e;">
        <p style="display:inline-block;margin:0 0 12px;padding:4px 10px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">${profile.badge}</p>
        <h2 style="margin:0 0 6px;">${profile.heading}</h2>
        <p style="margin:0 0 6px;color:#475569;">${profile.summary}</p>
        <p style="margin:0 0 16px;color:#475569;"><strong>Suggested next step:</strong> ${profile.nextStep} This is a short website inquiry: no files, claim numbers, or policyholder information were collected.</p>
        <table style="border-collapse:collapse;width:100%;max-width:720px;">${htmlRows}</table>
        <p style="margin:16px 0 0;color:#64748b;font-size:12px;">Lead ${escapeHtml(meta.leadId)} &middot; received ${escapeHtml(meta.receivedAt)}. Reply to this email to respond to the sender.</p>
      </div>
    `;

  const text = [
    profile.textBanner,
    profile.summary,
    `Suggested next step: ${profile.nextStep}`,
    "No files, claim numbers, or policyholder information were collected.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `Lead ${meta.leadId}, received ${meta.receivedAt}. Reply to this email to respond to the sender.`
  ].join("\n");

  return {
    subject: `${profile.subjectLabel} ${meta.leadId} — ItemAssist`,
    html,
    text,
    tags: [{ name: "lead_type", value: profile.leadType }]
  };
}

module.exports = { REQUEST_PROFILES, GENERIC_LEAD_TYPE, profileFor, buildInternalNotification, escapeHtml, sourceLabel };
