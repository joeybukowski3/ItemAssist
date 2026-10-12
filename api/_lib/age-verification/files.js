const AVFileRules = require("../../../assets/js/av-file-rules.js");

const MAX_SHARED_DOCUMENTS = AVFileRules.MAX_SHARED_DOCUMENTS;

/**
 * @typedef {{filename:string, mimeType:string, size:number}} FileMeta
 */

/**
 * Validates the full set of uploaded files for one submission against the
 * shared extension/MIME/size/count rules, plus the per-request cap on
 * shared supporting documents.
 *
 * @param {FileMeta[]} allFiles every uploaded file in the request
 * @param {FileMeta[]} sharedDocuments only the shared-document uploads
 * @returns {string|null} error message, or null when valid
 */
function validateUploadSet(allFiles, sharedDocuments) {
  const files = allFiles || [];
  const shared = sharedDocuments || [];

  if (shared.length > MAX_SHARED_DOCUMENTS) {
    return `Please attach no more than ${MAX_SHARED_DOCUMENTS} shared supporting documents.`;
  }

  return AVFileRules.validateFileSet(
    files.map((file) => ({ name: file.filename, size: file.size, type: file.mimeType }))
  );
}

function sanitizeFilename(filename) {
  return AVFileRules.sanitizeFilename(filename);
}

function isAllowedAttachment(filename, mimeType) {
  return AVFileRules.isAllowedExtension(filename) && AVFileRules.isAllowedMimeType(mimeType);
}

module.exports = {
  MAX_FILE_SIZE_BYTES: AVFileRules.MAX_FILE_SIZE_BYTES,
  MAX_TOTAL_BYTES: AVFileRules.MAX_TOTAL_BYTES,
  MAX_FILE_COUNT: AVFileRules.MAX_FILE_COUNT,
  MAX_SHARED_DOCUMENTS,
  validateUploadSet,
  sanitizeFilename,
  isAllowedAttachment
};
