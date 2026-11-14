/**
 * @param {string} name
 * @returns {string}
 */
function requiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`${name} is not set in Script properties`);
  return value;
}

/**
 * @param {Date} date
 * @returns {string}
 */
function isoDate_(date) {
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * @param {string} iso
 * @returns {Date}
 */
function parseIsoDate_(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * @param {string} iso
 * @param {string} hhmm
 * @returns {Date}
 */
function dateAt_(iso, hhmm) {
  const [h, min] = hhmm.split(':').map(Number);
  const date = parseIsoDate_(iso);
  date.setHours(h, min);
  return date;
}

/**
 * @param {Date} date
 * @returns {Date}
 */
function startOfDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * @param {Date} date
 * @param {number} days
 * @returns {Date}
 */
function addDays_(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
