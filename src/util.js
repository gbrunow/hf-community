function requiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`${name} is not set in Script properties`);
  return value;
}

function isoDate_(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseIsoDate_(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dateAt_(iso, hhmm) {
  const [h, min] = hhmm.split(':').map(Number);
  const date = parseIsoDate_(iso);
  date.setHours(h, min);
  return date;
}

function startOfDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays_(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
