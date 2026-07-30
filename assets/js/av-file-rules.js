/*
 * Shared upload-limit constants and pure validation helpers for the
 * /request-age-verification intake form. Isomorphic: loaded via <script>
 * in the browser (window.AVFileRules) and required directly in Node tests.
 */
(function (root) {
  "use strict";

  /* Proof-of-concept limits: files stay on the existing multipart/Resend-
   * attachment path (not direct-to-storage), so every byte of every upload
   * counts against Vercel's fixed 4.5MB Serverless Function request-body
   * limit alongside the rest of the multipart request -- form fields,
   * pasted item-list text, filenames, MIME headers, and multipart boundary
   * overhead. 2 files x 2MB each caps combined file bytes at 4MB, which
   * would leave almost no headroom, so the combined cap is set below that
   * ceiling (3.5MB) to leave roughly 1MB of headroom for everything else in
   * the request. Do not raise these without re-verifying the complete
   * multipart request stays safely under that platform limit. */
  var MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
  var MAX_TOTAL_BYTES = 3.5 * 1024 * 1024;
  var MAX_FILE_COUNT = 2;
  var ALLOWED_EXTENSIONS = [".pdf", ".xlsx", ".csv", ".docx", ".txt", ".jpg", ".jpeg", ".png"];
  var ALLOWED_MIME_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "image/jpeg",
    "image/png"
  ];
  var MAX_SHARED_DOCUMENTS = 2;
  var UPLOAD_LIMIT_SUMMARY = "Upload up to 2 files, with a maximum combined size of 3.5 MB.";
  var ALLOWED_TYPES_SUMMARY = "PDF, XLSX, CSV, DOCX, TXT, JPG, JPEG, or PNG";

  function formatMB(bytes) {
    var mb = bytes / (1024 * 1024);
    return (Math.round(mb * 10) / 10).toString();
  }

  function getExtension(filename) {
    var value = String(filename || "").trim().toLowerCase();
    var index = value.lastIndexOf(".");
    return index >= 0 ? value.slice(index) : "";
  }

  function isAllowedExtension(filename) {
    return ALLOWED_EXTENSIONS.indexOf(getExtension(filename)) !== -1;
  }

  function isAllowedMimeType(mimeType) {
    var normalized = String(mimeType || "").toLowerCase();
    if (!normalized || normalized === "application/octet-stream") {
      return true;
    }
    return ALLOWED_MIME_TYPES.indexOf(normalized) !== -1;
  }

  /**
   * @param {Array<{name:string, size:number, type?:string, mimeType?:string}>} files
   * @returns {string|null} error message, or null when valid
   */
  function validateFileSet(files) {
    var list = files || [];

    if (list.length > MAX_FILE_COUNT) {
      return "Please attach no more than " + MAX_FILE_COUNT + " files in total.";
    }

    var totalSize = 0;

    for (var i = 0; i < list.length; i++) {
      var file = list[i];
      var mimeType = file.type || file.mimeType || "";

      if (!isAllowedExtension(file.name)) {
        return "Only " + ALLOWED_TYPES_SUMMARY + " files are accepted.";
      }

      if (!isAllowedMimeType(mimeType)) {
        return "Only " + ALLOWED_TYPES_SUMMARY + " files are accepted.";
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        return "Each file must be " + formatMB(MAX_FILE_SIZE_BYTES) + "MB or smaller.";
      }

      totalSize += file.size;
    }

    if (totalSize > MAX_TOTAL_BYTES) {
      return "Total attachment size must be " + formatMB(MAX_TOTAL_BYTES) + "MB or smaller.";
    }

    return null;
  }

  function sanitizeFilename(filename) {
    var raw = String(filename || "attachment");
    var cleaned = "";

    for (var i = 0; i < raw.length; i++) {
      var code = raw.charCodeAt(i);
      var char = raw[i];
      var isControl = code < 32 || code === 127;
      var isUnsafe = char === "<" || char === ">" || char === ":" || char === '"' || char === "/" || char === "\\" || char === "|" || char === "?" || char === "*";

      if (isControl || isUnsafe) {
        cleaned += "_";
      } else {
        cleaned += char;
      }
    }

    cleaned = cleaned.replace(/\s+/g, " ").trim();

    return cleaned || "attachment";
  }

  var api = {
    MAX_FILE_SIZE_BYTES: MAX_FILE_SIZE_BYTES,
    MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,
    MAX_FILE_COUNT: MAX_FILE_COUNT,
    MAX_SHARED_DOCUMENTS: MAX_SHARED_DOCUMENTS,
    ALLOWED_EXTENSIONS: ALLOWED_EXTENSIONS,
    ALLOWED_MIME_TYPES: ALLOWED_MIME_TYPES,
    UPLOAD_LIMIT_SUMMARY: UPLOAD_LIMIT_SUMMARY,
    formatMB: formatMB,
    ALLOWED_TYPES_SUMMARY: ALLOWED_TYPES_SUMMARY,
    getExtension: getExtension,
    isAllowedExtension: isAllowedExtension,
    isAllowedMimeType: isAllowedMimeType,
    validateFileSet: validateFileSet,
    sanitizeFilename: sanitizeFilename
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.AVFileRules = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
