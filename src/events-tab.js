/**
 * Reads a studio's events tab into records, one per row or side-table entry, without
 * interpreting them. The table sits in the first columns under a header row that starts
 * with "Date"; a row with no date belongs to the date above it; anything further right is a
 * side table whose entries carry their own date.
 */

// Columns A-I hold the table; side notes sit to the right of them.
const EVENTS_TABLE_COLUMNS = 9;

/**
 * @param {Studio} studio
 * @param {SyncWindow} window
 * @returns {{ records: EventsRecord[], sheetUrl: string }}
 */
function readEventsTab_(studio, window) {
  const spreadsheet = SpreadsheetApp.openById(
    requiredProperty_('SOURCE_SPREADSHEET_ID'),
  );
  const sheetUrl = spreadsheetUrl_(spreadsheet);
  const sheets = spreadsheet.getSheets();
  /** @type {EventsRecord[]} */
  const records = [];
  for (
    let year = window.windowStart.getFullYear();
    year <= window.windowEnd.getFullYear();
    year++
  ) {
    const sheet = findEventsTab_(sheets, studio, year);
    if (!sheet) {
      if (year === window.today.getFullYear()) {
        console.warn(
          `No events tab for ${studio.header} ${year}; its events are removed.`,
        );
      }
      continue;
    }
    const gid = sheet.getSheetId();
    records.push(
      ...eventsRecords_(
        sheet.getDataRange().getDisplayValues(),
        year,
        window,
        `${sheetUrl}?gid=${gid}#gid=${gid}`,
        studio.header,
      ),
    );
  }
  return { records, sheetUrl };
}

/**
 * Throws on more than one match (e.g. a "Copy of" tab) rather than guess which is live.
 *
 * @param {SheetTab[]} sheets
 * @param {Studio} studio
 * @param {number} year
 * @returns {SheetTab | null}
 */
function findEventsTab_(sheets, studio, year) {
  const matches = sheets.filter(
    (sheet) =>
      studio.eventsTab?.test(sheet.getName()) &&
      sheet.getName().includes(String(year)),
  );
  if (matches.length > 1) {
    throw new Error(
      `Several tabs match ${studio.header}'s events ${year}: ${matches.map((s) => `"${s.getName()}"`).join(', ')}`,
    );
  }
  return matches[0] || null;
}

/**
 * @param {string[][]} rows as getDisplayValues() returns them
 * @param {number} year the one the date column leaves out
 * @param {SyncWindow} window
 * @param {string} tabUrl the sheet's URL with the tab's gid
 * @param {string} studioName for warnings
 * @returns {EventsRecord[]}
 */
function eventsRecords_(rows, year, window, tabUrl, studioName) {
  const headerIndex = rows.findIndex(
    (row) => String(row[0]).trim().toLowerCase() === 'date',
  );
  if (headerIndex < 0) {
    console.warn(`${studioName}: no header row with "Date" in column A of the events tab.`);
    return [];
  }
  const headers = rows[headerIndex]
    .slice(0, EVENTS_TABLE_COLUMNS)
    .map((header) => String(header).trim());
  const eventColumn = headers.findIndex((h) => h.toLowerCase() === 'event');
  if (eventColumn < 0) {
    console.warn(`${studioName}: no "Event" column in the events tab.`);
    return [];
  }
  const lastColumn = columnLetter_(headers.reduce((last, h, i) => (h ? i : last), 0));

  const { windowStart, windowEnd } = window;
  const inWindow = (/** @type {Date} */ date) => date >= windowStart && date <= windowEnd;
  /** @type {EventsRecord[]} */
  const records = [];
  /** @type {{ date: Date, label: string } | null} */
  let current = null;
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1; // The data range starts at A1.
    const dateText = String(row[0] ?? '').trim();
    if (dateText) {
      const date = parseRowDate_(dateText, year);
      current = date ? { date, label: dateText } : null;
    }

    if (current && inWindow(current.date)) {
      /** @type {Record<string, string>} */
      const fields = {};
      for (let c = 1; c < EVENTS_TABLE_COLUMNS; c++) {
        const value = cleanCell_(row[c]);
        if (value && headers[c]) fields[headers[c]] = value;
      }
      if (Object.keys(fields).length) {
        records.push({
          kind: cleanCell_(row[eventColumn]) ? 'schedule' : 'announcement',
          date: current.date,
          dateLabel: current.label,
          rowNumber,
          fields,
          url: `${tabUrl}&range=A${rowNumber}:${lastColumn}${rowNumber}`,
        });
      }
    }

    const side = sideEntry_(row, rowNumber, year, studioName);
    if (side && inWindow(side.date)) {
      records.push({
        kind: 'side',
        date: side.date,
        dateLabel: side.dateLabel,
        rowNumber,
        fields: { 'Side table': side.text },
        url: `${tabUrl}&range=${side.range}`,
      });
    }
  }
  return records;
}

/**
 * The entry in the columns right of the table, if the row has one: its non-empty cells in
 * order, the first of which that reads as a date being the entry's date.
 *
 * @param {string[]} row
 * @param {number} rowNumber
 * @param {number} year
 * @param {string} studioName for warnings
 * @returns {{ date: Date, dateLabel: string, text: string, range: string } | null}
 */
function sideEntry_(row, rowNumber, year, studioName) {
  const cells = [];
  for (let c = EVENTS_TABLE_COLUMNS; c < row.length; c++) {
    const value = cleanCell_(row[c]);
    if (value) cells.push({ column: c, value });
  }
  if (!cells.length) return null;
  const dated = cells.find((cell) => parseRowDate_(cell.value, year));
  const date = dated && parseRowDate_(dated.value, year);
  if (!dated || !date) {
    console.warn(
      `${studioName}: skipped side-table text without a date in row ${rowNumber}: ${cells.map((c) => c.value).join(' | ')}`,
    );
    return null;
  }
  const first = columnLetter_(cells[0].column);
  const last = columnLetter_(cells[cells.length - 1].column);
  return {
    date,
    dateLabel: dated.value,
    text: cells.map((cell) => cell.value).join(' | '),
    range: `${first}${rowNumber}:${last}${rowNumber}`,
  };
}

/**
 * @param {unknown} value
 * @returns {string} the cell trimmed, with runs of whitespace collapsed
 */
function cleanCell_(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}
