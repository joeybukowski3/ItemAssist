/*
 * Shared upload-limit constants and pure validation helpers for the
 * /request-age-verification intake form. Isomorphic: loaded via <script>
 * in the browser (window.AVFileRules) and required directly in Node tests.
 */
(function (root) {
  "use strict";

  var MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
  var MAX_TOTAL_BYTES = 20 * 1024 * 1024;
  var MAX_FILE_COUNT = 10;
  var ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf"];
  var ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"];
  var MAX_SHARED_DOCUMENTS = 2;

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
        return "Only JPG, JPEG, PNG, and PDF files are accepted.";
      }

      if (!isAllowedMimeType(mimeType)) {
        return "Only JPG, JPEG, PNG, and PDF files are accepted.";
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        return "Each file must be " + Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024)) + "MB or smaller.";
      }

      totalSize += file.size;
    }

    if (totalSize > MAX_TOTAL_BYTES) {
      return "Total attachment size must be " + Math.round(MAX_TOTAL_BYTES / (1024 * 1024)) + "MB or smaller.";
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
