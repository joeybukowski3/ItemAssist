import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AVFileRules = require("../../../assets/js/av-file-rules.js");
const serverFiles = require("../../../api/lib/age-verification/files.js");

test("validateFileSet accepts allowed types under the size/count limits", () => {
  const error = AVFileRules.validateFileSet([
    { name: "label.jpg", size: 1024 * 1024, type: "image/jpeg" },
    { name: "overview.png", size: 1024 * 1024, type: "image/png" },
    { name: "invoice.pdf", size: 1024 * 1024, type: "application/pdf" }
  ]);

  assert.equal(error, null);
});

test("validateFileSet rejects a disallowed extension", () => {
  const error = AVFileRules.validateFileSet([{ name: "malware.exe", size: 100, type: "application/octet-stream" }]);
  assert.match(error, /JPG, JPEG, PNG, and PDF/);
});

test("validateFileSet rejects a mismatched MIME type for an allowed extension", () => {
  const error = AVFileRules.validateFileSet([{ name: "label.jpg", size: 100, type: "text/html" }]);
  assert.match(error, /JPG, JPEG, PNG, and PDF/);
});

test("validateFileSet rejects a single file over 5MB", () => {
  const error = AVFileRules.validateFileSet([{ name: "big.jpg", size: 6 * 1024 * 1024, type: "image/jpeg" }]);
  assert.match(error, /5MB or smaller/);
});

test("validateFileSet rejects a total over 20MB even if each file is individually fine", () => {
  const files = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.jpg`, size: 4.5 * 1024 * 1024, type: "image/jpeg" }));
  const error = AVFileRules.validateFileSet(files);
  assert.match(error, /20MB or smaller/);
});

test("validateFileSet rejects more than 10 files", () => {
  const files = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.jpg`, size: 1000, type: "image/jpeg" }));
  const error = AVFileRules.validateFileSet(files);
  assert.match(error, /no more than 10 files/);
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

test("server files.validateUploadSet accepts a valid mixed item + shared document set", () => {
  const itemFiles = [{ filename: "label.jpg", mimeType: "image/jpeg", size: 1000 }];
  const sharedDocuments = [{ filename: "doc1.pdf", mimeType: "application/pdf", size: 1000 }];
  const error = serverFiles.validateUploadSet(itemFiles.concat(sharedDocuments), sharedDocuments);
  assert.equal(error, null);
});

test("isAllowedAttachment matches extension + MIME together", () => {
  assert.equal(serverFiles.isAllowedAttachment("photo.jpg", "image/jpeg"), true);
  assert.equal(serverFiles.isAllowedAttachment("photo.jpg", "application/zip"), false);
  assert.equal(serverFiles.isAllowedAttachment("photo.exe", "image/jpeg"), false);
});
