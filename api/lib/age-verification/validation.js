const AVShared = require("../../../assets/js/av-shared.js");

const CUSTOMER_TYPES = AVShared.CUSTOMER_TYPES;
const PROFESSIONAL_CUSTOMER_TYPES = AVShared.PROFESSIONAL_CUSTOMER_TYPES;
const REQUESTED_SERVICES = AVShared.REQUESTED_SERVICES;
const RESULT_STATUSES = AVShared.RESULT_STATUSES;

const PREFERRED_CONTACT_METHODS = ["email", "phone", "either"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidEmail(value) {
  return isNonEmptyString(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isProfessionalCustomerType(customerType) {
  return PROFESSIONAL_CUSTOMER_TYPES.indexOf(customerType) !== -1;
}

/**
 * @param {object} fields
 * @returns {string[]} field-level validation errors, empty when valid
 */
function validateContactFields(fields) {
  const errors = [];
  const data = fields || {};

  if (!isNonEmptyString(data.fullName)) {
    errors.push("Full name is required.");
  }

  if (!isValidEmail(data.email)) {
    errors.push("A valid email address is required.");
  }

  if (!isNonEmptyString(data.phone)) {
    errors.push("Phone number is required.");
  }

  if (CUSTOMER_TYPES.indexOf(data.customerType) === -1) {
    errors.push("Please select what best describes you.");
  }

  if (PREFERRED_CONTACT_METHODS.indexOf(data.preferredContactMethod) === -1) {
    errors.push("Please select a preferred contact method.");
  }

  if (isProfessionalCustomerType(data.customerType) && !isNonEmptyString(data.company)) {
    errors.push("Company or organization is required for this customer type.");
  }

  if (REQUESTED_SERVICES.indexOf(data.requestedService) === -1) {
    errors.push("Please select the requested service.");
  }

  if (!isNonEmptyString(data.reasonForRequest)) {
    errors.push("Please describe the reason for the request.");
  }

  if (!data.authorizationAck) {
    errors.push("Please confirm the authorization statement before submitting.");
  }

  if (!data.limitationsAck) {
    errors.push("Please confirm the service-limitations statement before submitting.");
  }

  return errors;
}

/**
 * @param {object} item
 * @returns {string[]}
 */
function validateItem(item) {
  const errors = [];
  const data = item || {};

  if (!isNonEmptyString(data.category)) {
    errors.push("Each item needs a category.");
  }

  if (!isNonEmptyString(data.serial) && !data.noSerial) {
    errors.push("Provide a serial number or confirm the item has no readable serial number.");
  }

  return errors;
}

/**
 * @param {Array<object>} items
 * @returns {string[]}
 */
function validateItems(items) {
  const list = Array.isArray(items) ? items : [];

  if (list.length === 0) {
    return ["At least one item is required."];
  }

  const errors = [];
  list.forEach((item, index) => {
    validateItem(item).forEach((message) => {
      errors.push(`Item ${index + 1}: ${message}`);
    });
  });

  return errors;
}

function isValidResultStatus(value) {
  return value === "" || RESULT_STATUSES.indexOf(value) !== -1;
}

module.exports = {
  CUSTOMER_TYPES,
  PROFESSIONAL_CUSTOMER_TYPES,
  REQUESTED_SERVICES,
  PREFERRED_CONTACT_METHODS,
  isNonEmptyString,
  isValidEmail,
  isProfessionalCustomerType,
  validateContactFields,
  validateItem,
  validateItems,
  isValidResultStatus
};
