const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function readCells_(today, windowStart, windowEnd) {
  const spreadsheet = SpreadsheetApp.openById(
    requiredProperty_('SOURCE_SPREADSHEET_ID'),
  );
  const cells = [];
  for (
    let year = windowStart.getFullYear();
    year <= windowEnd.getFullYear();
    year++
  ) {
    const sheet = findYearTab_(spreadsheet.getSheets(), year);
    if (!sheet) {
      // A missing current-year tab would look like every cell was cleared and wipe the
      // calendars, so fail instead. A missing adjacent year just isn't created yet.
      if (year === today.getFullYear()) {
        throw new Error(
          `No tab named with "${CONFIG.TAB_KEYWORD}" and ${year}`,
        );
      }
      continue;
    }
    const rows = sheet.getDataRange().getDisplayValues();
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.getId()}/edit`;
    const gid = sheet.getSheetId();
    for (const cell of cellsFromRows_(rows, year, windowStart, windowEnd)) {
      cell.sheetUrl = sheetUrl;
      cell.rowUrl = `${sheetUrl}?gid=${gid}#gid=${gid}&range=${cell.rowRange}`;
      cells.push(cell);
    }
  }
  return cells;
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
function columnLetter_(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** Throws on more than one match (e.g. a "Copy of" tab) rather than guess which is live. */
function findYearTab_(sheets, year) {
  const matches = sheets.filter((sheet) => {
    const name = sheet.getName().toLowerCase();
    return (
      name.includes(CONFIG.TAB_KEYWORD.toLowerCase()) &&
      name.includes(String(year))
    );
  });
  if (matches.length > 1) {
    throw new Error(
      `Several tabs match ${year}: ${matches.map((s) => `"${s.getName()}"`).join(', ')}`,
    );
  }
  return matches[0] || null;
}

/**
 * Finds the header row by its "Date" cell and the studio columns by header name, since
 * columns have moved between them before.
 */
function cellsFromRows_(rows, year, windowStart, windowEnd) {
  const headerIndex = rows.findIndex(
    (row) => String(row[0]).trim().toLowerCase() === 'date',
  );
  if (headerIndex < 0) throw new Error('No header row with "Date" in column A');

  const header = rows[headerIndex].map((h) => String(h).trim().toLowerCase());
  const enabled = CONFIG.STUDIOS.filter((studio) => studio.enabled);
  const columns = enabled.map((studio) => {
    const col = header.indexOf(studio.header.toLowerCase());
    if (col < 0)
      throw new Error(`No "${studio.header}" column in the header row`);
    return { studio, col };
  });

  // Links select the whole row, from column A to the last column with a header.
  const lastColumn = columnLetter_(
    header.reduce((last, h, index) => (h ? index : last), 0),
  );

  const cells = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const date = parseRowDate_(row[0], year);
    if (!date || date < windowStart || date > windowEnd) continue;
    for (const { studio, col } of columns) {
      const text = String(row[col] || '')
        .trim()
        .replace(/\s+/g, ' ');
      // The data range starts at A1, so the sheet row number is the index plus one.
      if (text) {
        const dateLabel = String(row[0]).trim();
        const rowRange = `A${i + 1}:${lastColumn}${i + 1}`;
        cells.push({ studio, date, dateLabel, text, rowRange });
      }
    }
  }
  return cells;
}

/** Parses "Fri, Oct 9" (weekday optional) into a local date in the given year. */
function parseRowDate_(value, year) {
  const match = String(value)
    .trim()
    .match(/^(?:[A-Za-z]+,?\s+)?([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (month === undefined) return null;
  return new Date(year, month, Number(match[2]));
}
