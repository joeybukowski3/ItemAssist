const { REASONS, ITEM_COUNT_BANDS } = require("./validation");

/** Marks every notification, log line and email tag raised by the short consultation form. */
const LEAD_TYPE = "consultation_inquiry";

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
    ["Name", fields.name],
    ["Email", fields.email],
    ["Reason for inquiry", REASONS[fields.reason] || fields.reason],
    ["Company", fields.company],
    ["Phone", fields.phone],
    ["Approximate item count", fields.itemCount && (ITEM_COUNT_BANDS[fields.itemCount] || fields.itemCount)],
    ["Short description", fields.description],
    ["Marketing source", sourceLabel(fields.source)]
  ];
  return rows.filter(([, value]) => Boolean(value));
}

/**
 * Builds the internal notification for a consultation inquiry. The subject is
 * fixed text plus the server-generated lead id: nothing the visitor typed ever
 * reaches the subject line or a header. Every value in the body is escaped.
 *
 * @param {object} fields normalized fields from validateConsultation
 * @param {{leadId: string, receivedAt: string}} meta
 * @returns {{subject: string, html: string, text: string, tags: Array<{name: string, value: string}>}}
 */
function buildInternalNotification(fields, meta) {
  const rows = detailRows(fields);

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px;font-weight:700;vertical-align:top;border:1px solid #dbe4f0;">${escapeHtml(label)}</td><td style="padding:8px 12px;vertical-align:top;border:1px solid #dbe4f0;">${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`
    )
    .join("");

  const html = `
      <div style="font-family:Arial,sans-serif;color:#10243e;">
        <p style="display:inline-block;margin:0 0 12px;padding:4px 10px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">Consultation inquiry &middot; marketing lead</p>
        <h2 style="margin:0 0 6px;">New Item Assist consultation inquiry</h2>
        <p style="margin:0 0 16px;color:#475569;">This is a short-form inquiry from the website, <strong>not</strong> an assignment submission. No files or claim information were collected.</p>
        <table style="border-collapse:collapse;width:100%;max-width:720px;">${htmlRows}</table>
        <p style="margin:16px 0 0;color:#64748b;font-size:12px;">Lead ${escapeHtml(meta.leadId)} &middot; received ${escapeHtml(meta.receivedAt)}. Reply to this email to respond to the sender.</p>
      </div>
    `;

  const text = [
    "CONSULTATION INQUIRY (marketing lead) - not an assignment submission.",
    "No files or claim information were collected.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `Lead ${meta.leadId}, received ${meta.receivedAt}. Reply to this email to respond to the sender.`
  ].join("\n");

  return {
    subject: `New Consultation Inquiry ${meta.leadId} — ItemAssist`,
    html,
    text,
    tags: [{ name: "lead_type", value: LEAD_TYPE }]
  };
}

module.exports = { LEAD_TYPE, buildInternalNotification, escapeHtml, sourceLabel };
