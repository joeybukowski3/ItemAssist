import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AVFileRules = require("../../../assets/js/av-file-rules.js");
const serverFiles = require("../../../api/lib/age-verification/files.js");

test("validateFileSet accepts every supported type under the size/count limits", () => {
  const error = AVFileRules.validateFileSet([
    { name: "label.jpg", size: 1024 * 1024, type: "image/jpeg" },
    { name: "invoice.pdf", size: 1024 * 1024, type: "application/pdf" }
  ]);

  assert.equal(error, null);
});

test("validateFileSet accepts each of the nine allowed extensions individually", () => {
  const cases = [
    { name: "a.pdf", type: "application/pdf" },
    { name: "a.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { name: "a.csv", type: "text/csv" },
    { name: "a.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { name: "a.txt", type: "text/plain" },
    { name: "a.jpg", type: "image/jpeg" },
    { name: "a.jpeg", type: "image/jpeg" },
    { name: "a.png", type: "image/png" }
  ];

  cases.forEach((file) => {
    const error = AVFileRules.validateFileSet([{ ...file, size: 1000 }]);
    assert.equal(error, null, `expected ${file.name} to be accepted, got: ${error}`);
  });
});

test("validateFileSet rejects XLS (not in the proof-of-concept allowlist)", () => {
  const error = AVFileRules.validateFileSet([{ name: "book.xls", size: 1000, type: "application/vnd.ms-excel" }]);
  assert.match(error, /PDF, XLSX, CSV, DOCX, TXT, JPG, JPEG, or PNG/);
});

test("validateFileSet rejects a disallowed extension", () => {
  const error = AVFileRules.validateFileSet([{ name: "malware.exe", size: 100, type: "application/octet-stream" }]);
  assert.match(error, /PDF, XLSX, CSV, DOCX, TXT, JPG, JPEG, or PNG/);
});

test("validateFileSet rejects a mismatched MIME type for an allowed extension", () => {
  const error = AVFileRules.validateFileSet([{ name: "label.jpg", size: 100, type: "text/html" }]);
  assert.match(error, /PDF, XLSX, CSV, DOCX, TXT, JPG, JPEG, or PNG/);
});

test("validateFileSet rejects a single file over 2MB", () => {
  const error = AVFileRules.validateFileSet([{ name: "big.jpg", size: 2.5 * 1024 * 1024, type: "image/jpeg" }]);
  assert.match(error, /2MB or smaller/);
});

test("validateFileSet rejects more than 2 files", () => {
  const files = Array.from({ length: 3 }, (_, i) => ({ name: `f${i}.jpg`, size: 1000, type: "image/jpeg" }));
  const error = AVFileRules.validateFileSet(files);
  assert.match(error, /no more than 2 files/);
});

test("combined file bytes are capped at 3.5MB, leaving roughly 1MB of headroom under Vercel's 4.5MB request-body limit", () => {
  // 2 files x 2MB each caps possible file bytes at 4MB -- the combined limit
  // is deliberately set below that (3.5MB), not at it, because the same
  // multipart request also carries form fields, pasted item-list text,
  // filenames, MIME headers, and multipart boundary overhead. This test
  // documents the arithmetic; it does not claim 2x2MB alone guarantees
  // safety -- validateFileSet's own combined-size check is what enforces it.
  const VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

  assert.equal(AVFileRules.MAX_TOTAL_BYTES, 3.5 * 1024 * 1024);

  const headroomBytes = VERCEL_FUNCTION_BODY_LIMIT_BYTES - AVFileRules.MAX_TOTAL_BYTES;
  assert.ok(headroomBytes >= 0.9 * 1024 * 1024, "expected at least ~1MB of headroom for form data and multipart overhead");
  assert.ok(headroomBytes <= 1.1 * 1024 * 1024, "headroom should be approximately 1MB, not dramatically more or less");
});

test("oversized individual files are rejected even when the combined total would otherwise be within budget", () => {
  const error = AVFileRules.validateFileSet([{ name: "big.pdf", size: 2.1 * 1024 * 1024, type: "application/pdf" }]);
  assert.match(error, /2MB or smaller/);
});

test("oversized combined files are rejected even when each file is individually within the per-file limit", () => {
  // Two files at 2MB each = 4MB combined, which exceeds the 3.5MB combined
  // cap even though neither file individually violates MAX_FILE_SIZE_BYTES.
  const files = [
    { name: "a.pdf", size: 2 * 1024 * 1024, type: "application/pdf" },
    { name: "b.pdf", size: 2 * 1024 * 1024, type: "application/pdf" }
  ];
  const error = AVFileRules.validateFileSet(files);
  assert.match(error, /3.5MB or smaller/);
});

test("two files under the combined 3.5MB cap are accepted", () => {
  const files = [
    { name: "a.pdf", size: 1.5 * 1024 * 1024, type: "application/pdf" },
    { name: "b.pdf", size: 1.9 * 1024 * 1024, type: "application/pdf" }
  ];
  const error = AVFileRules.validateFileSet(files);
  assert.equal(error, null);
});

test("sanitizeFilename strips unsafe characters and path separators", () => {
  assert.equal(AVFileRules.sanitizeFilename("../../etc/passwd.jpg"), ".._.._etc_passwd.jpg");
  assert.equal(AVFileRules.sanitizeFilename('weird<>:"|?*name.png'), "weird_______name.png");
  assert.equal(AVFileRules.sanitizeFilename(""), "attachment");
});

test("server files.validateUploadSet enforces the shared-document cap of 2", () => {
  const sharedDocuments = [
    { filename: "doc1.pdf", mimeType: "application/pdf", size: 1000 },
    { filename: "doc2.pdf", mimeType: "application/pdf", size: 1000 },
    { filename: "doc3.pdf", mimeType: "application/pdf", size: 1000 }
  ];

  const error = serverFiles.validateUploadSet(sharedDocuments, sharedDocuments);
  assert.match(error, /no more than 2 shared supporting documents/);
});

test("server files.validateUploadSet accepts a valid shared document set", () => {
  const sharedDocuments = [
    { filename: "list.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 1000 },
    { filename: "doc1.pdf", mimeType: "application/pdf", size: 1000 }
  ];
  const error = serverFiles.validateUploadSet(sharedDocuments, sharedDocuments);
  assert.equal(error, null);
});

test("isAllowedAttachment matches extension + MIME together", () => {
  assert.equal(serverFiles.isAllowedAttachment("photo.jpg", "image/jpeg"), true);
  assert.equal(serverFiles.isAllowedAttachment("list.csv", "text/csv"), true);
  assert.equal(serverFiles.isAllowedAttachment("doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), true);
  assert.equal(serverFiles.isAllowedAttachment("photo.jpg", "application/zip"), false);
  assert.equal(serverFiles.isAllowedAttachment("photo.exe", "image/jpeg"), false);
});

test("centralized limits are exposed for both client and server consumers", () => {
  assert.equal(AVFileRules.MAX_FILE_COUNT, 2);
  assert.equal(AVFileRules.MAX_FILE_SIZE_BYTES, 2 * 1024 * 1024);
  assert.equal(AVFileRules.MAX_TOTAL_BYTES, 3.5 * 1024 * 1024);
  assert.equal(serverFiles.MAX_FILE_COUNT, AVFileRules.MAX_FILE_COUNT);
  assert.equal(serverFiles.MAX_FILE_SIZE_BYTES, AVFileRules.MAX_FILE_SIZE_BYTES);
  assert.equal(serverFiles.MAX_TOTAL_BYTES, AVFileRules.MAX_TOTAL_BYTES);
});
