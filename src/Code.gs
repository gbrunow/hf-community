/**
 * Syncs the studio kiln log (a Google Sheet) into one Google Calendar per studio.
 *
 * Every non-empty studio cell becomes an all-day status event. Any note that names a
 * clock time ("unload by ~4pm", "unload 10/10 by 11am") also becomes a timed event.
 * Gemini parses the free-form notes; each cell is parsed once and remembered by a hash
 * of its content, so an edited cell has its events replaced and a cleared cell has
 * them removed.
 *
 * Setup:
 *   1. Project Settings → Script properties → add SOURCE_SPREADSHEET_ID (the long id in
 *      the source sheet's URL) and GEMINI_API_KEY. Kept out of the code so pasting in a
 *      new version doesn't wipe them. Optionally add GEMINI_MODEL to override
 *      CONFIG.DEFAULT_GEMINI_MODEL when Google retires a model.
 *   2. Project Settings → set the time zone to the studio's.
 *   3. Run preview() and check the log. Nothing is written.
 *   4. Run sync() once, then installTrigger().
 */

const CONFIG = {
  // One tab per year, found by a name containing this word and the year, case-insensitive
  // (e.g. "Kiln Notes 2026"). The year also supplies the one the date column leaves out.
  TAB_KEYWORD: 'kiln',
  STUDIOS: [
    { header: 'Downtown', calendarName: 'Kiln · Downtown' },
    { header: 'JTown', calendarName: 'Kiln · JTown' },
  ],
  // Only this window is synced. Older rows keep their events but are never revisited,
  // so after-the-fact edits ("to be loaded" → "loaded") don't churn history.
  WINDOW_PAST_DAYS: 1,
  WINDOW_FUTURE_DAYS: 14,
  TIMED_EVENT_MINUTES: 30,
  SYNC_EVERY_HOURS: 1, // Apps Script allows 1, 2, 4, 6, 8 or 12.
  DEFAULT_GEMINI_MODEL: 'gemini-3.8-flash', // Overridden by the GEMINI_MODEL script property.
};

const STATE_PREFIX = 'cell:';

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const SYSTEM_PROMPT = `You read one note from a pottery studio's kiln log. The note describes
what the kilns are doing on one day at one studio. Reply with JSON:

- "status": the note as a short, clean status line. Fix obvious typos and casing. Drop only
  the time details you moved into "timed"; keep everything else, including vague timing.
  Never add information.
- "timed": one item per thing that happens at a specific clock time. Approximate times
  count ("~4pm", "6 ish", "around 5pm"). Each item has:
  - "title": a short label such as "Bisque unload".
  - "date": YYYY-MM-DD. Use the note's date unless the note names another date; "10/10"
    means October 10 of the nearest year.
  - "time": HH:MM, 24-hour. An hour without am/pm falls within studio hours, 09:00-21:59,
    so "6 ish" is 18:00.
  Vague timing ("in PM", "later", "possible unload") is not a timed item. Use an empty
  list when there are none.

Examples:
Date 2026-10-09, note "Bisque Loading, reduction cooling (unload 10/10 by 11am)"
→ {"status":"Bisque loading, reduction cooling","timed":[{"title":"Reduction unload","date":"2026-10-10","time":"11:00"}]}
Date 2026-06-05, note "Reduction late unload (by 6 ish), bisque loading"
→ {"status":"Reduction late unload, bisque loading","timed":[{"title":"Reduction unload","date":"2026-06-05","time":"18:00"}]}
Date 2026-10-10, note "reduction to be cooled, possible unload in PM"
→ {"status":"Reduction cooling, possible unload in the afternoon","timed":[]}`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    status: { type: 'STRING' },
    timed: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          date: { type: 'STRING' },
          time: { type: 'STRING' },
        },
        required: ['title', 'date', 'time'],
      },
    },
  },
  required: ['status', 'timed'],
};

function sync() {
  run_({ dryRun: false, pastDays: CONFIG.WINDOW_PAST_DAYS });
}

/** Logs what sync() would do, over a wider past window so there's more to look at. */
function preview() {
  run_({ dryRun: true, pastDays: 14 });
}

function installTrigger() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('sync').timeBased().everyHours(CONFIG.SYNC_EVERY_HOURS).create();
}

function run_({ dryRun, pastDays }) {
  const today = startOfDay_(new Date());
  const windowStart = addDays_(today, -pastDays);
  const windowEnd = addDays_(today, CONFIG.WINDOW_FUTURE_DAYS);

  const props = PropertiesService.getScriptProperties();
  const state = loadState_(props);
  const seen = new Set();

  for (const cell of readCells_(today, windowStart, windowEnd)) {
    const key = cellKey_(cell);
    seen.add(key);
    if (state[key]) continue;

    let parsed;
    try {
      parsed = parseNote_(cell);
    } catch (e) {
      // Not recorded, so the next run retries it.
      console.error(`Skipping ${describe_(cell)}: ${e.message}`);
      continue;
    }

    if (dryRun) {
      console.log(`${describe_(cell)}\n  → ${JSON.stringify(parsed)}`);
      continue;
    }
    const ids = createEvents_(getCalendar_(cell.studio.calendarName), cell, parsed);
    props.setProperty(STATE_PREFIX + key, JSON.stringify({
      calendarName: cell.studio.calendarName,
      date: isoDate_(cell.date),
      ids,
    }));
  }

  for (const [key, entry] of Object.entries(state)) {
    if (seen.has(key)) continue;
    const date = parseIsoDate_(entry.date);
    if (date < windowStart) {
      // Aged out of the window: keep its events, forget the cell.
      if (!dryRun) props.deleteProperty(STATE_PREFIX + key);
      continue;
    }
    if (date > windowEnd) continue;

    // Inside the window but no longer in the sheet: the cell was edited or cleared.
    if (dryRun) {
      console.log(`Would remove ${entry.ids.length} event(s) for ${entry.calendarName} ${entry.date}`);
      continue;
    }
    deleteEvents_(entry);
    props.deleteProperty(STATE_PREFIX + key);
  }
}

function readCells_(today, windowStart, windowEnd) {
  const spreadsheet = SpreadsheetApp.openById(requiredProperty_('SOURCE_SPREADSHEET_ID'));
  const cells = [];
  for (let year = windowStart.getFullYear(); year <= windowEnd.getFullYear(); year++) {
    const sheet = findYearTab_(spreadsheet.getSheets(), year);
    if (!sheet) {
      // A missing current-year tab would look like every cell was cleared and wipe the
      // calendars, so fail instead. A missing adjacent year just isn't created yet.
      if (year === today.getFullYear()) {
        throw new Error(`No tab named with "${CONFIG.TAB_KEYWORD}" and ${year}`);
      }
      continue;
    }
    const rows = sheet.getDataRange().getDisplayValues();
    cells.push(...cellsFromRows_(rows, year, windowStart, windowEnd));
  }
  return cells;
}

/** Throws on more than one match (e.g. a "Copy of" tab) rather than guess which is live. */
function findYearTab_(sheets, year) {
  const matches = sheets.filter((sheet) => {
    const name = sheet.getName().toLowerCase();
    return name.includes(CONFIG.TAB_KEYWORD.toLowerCase()) && name.includes(String(year));
  });
  if (matches.length > 1) {
    throw new Error(`Several tabs match ${year}: ${matches.map((s) => `"${s.getName()}"`).join(', ')}`);
  }
  return matches[0] || null;
}

/**
 * Finds the header row by its "Date" cell and the studio columns by header name, since
 * columns have moved between them before.
 */
function cellsFromRows_(rows, year, windowStart, windowEnd) {
  const headerIndex = rows.findIndex((row) => String(row[0]).trim().toLowerCase() === 'date');
  if (headerIndex < 0) throw new Error('No header row with "Date" in column A');

  const header = rows[headerIndex].map((h) => String(h).trim().toLowerCase());
  const columns = CONFIG.STUDIOS.map((studio) => {
    const col = header.indexOf(studio.header.toLowerCase());
    if (col < 0) throw new Error(`No "${studio.header}" column in the header row`);
    return { studio, col };
  });

  const cells = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const date = parseRowDate_(row[0], year);
    if (!date || date < windowStart || date > windowEnd) continue;
    for (const { studio, col } of columns) {
      const text = String(row[col] || '').trim().replace(/\s+/g, ' ');
      if (text) cells.push({ studio, date, text });
    }
  }
  return cells;
}

/** Parses "Fri, Oct 9" (weekday optional) into a local date in the given year. */
function parseRowDate_(value, year) {
  const match = String(value).trim().match(/^(?:[A-Za-z]+,?\s+)?([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (month === undefined) return null;
  return new Date(year, month, Number(match[2]));
}

function parseNote_(cell) {
  const apiKey = requiredProperty_('GEMINI_API_KEY');
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][cell.date.getDay()];
  const model = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL')
    || CONFIG.DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const request = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: 'user',
        parts: [{ text: `Date ${isoDate_(cell.date)} (${weekday}), note "${cell.text}"` }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  };

  let response;
  for (let attempt = 1; ; attempt++) {
    response = UrlFetchApp.fetch(url, request);
    const code = response.getResponseCode();
    if ((code !== 429 && code < 500) || attempt === 3) break;
    Utilities.sleep(10000 * attempt); // Free-tier rate limit or transient outage.
  }
  if (response.getResponseCode() !== 200) {
    throw new Error(`Gemini HTTP ${response.getResponseCode()}: ${response.getContentText().slice(0, 300)}`);
  }

  const body = JSON.parse(response.getContentText());
  return validateParsed_(JSON.parse(body.candidates[0].content.parts[0].text), cell);
}

/** Drops timed items the model got malformed or placed implausibly far from the row. */
function validateParsed_(parsed, cell) {
  const status = String(parsed.status || '').trim() || cell.text;
  const timed = (parsed.timed || []).filter((item) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) {
      return false;
    }
    const daysAway = Math.abs(parseIsoDate_(item.date) - cell.date) / 86400000;
    return daysAway <= 7;
  });
  return { status, timed };
}

function createEvents_(calendar, cell, parsed) {
  const description = `From the kiln log, ${cell.studio.header}, ${isoDate_(cell.date)}:\n${cell.text}`;
  const prefix = `${cell.studio.header}: `;
  const ids = [calendar.createAllDayEvent(prefix + parsed.status, cell.date, { description }).getId()];
  for (const item of parsed.timed) {
    const start = dateAt_(item.date, item.time);
    const end = new Date(start.getTime() + CONFIG.TIMED_EVENT_MINUTES * 60000);
    ids.push(calendar.createEvent(prefix + item.title, start, end, { description }).getId());
  }
  return ids;
}

function deleteEvents_(entry) {
  const calendar = CalendarApp.getCalendarsByName(entry.calendarName)[0];
  if (!calendar) return;
  for (const id of entry.ids) {
    const event = calendar.getEventById(id);
    if (event) event.deleteEvent(); // Null if it was already deleted by hand.
  }
}

const calendarCache_ = {};

function getCalendar_(name) {
  if (!calendarCache_[name]) {
    calendarCache_[name] = CalendarApp.getCalendarsByName(name)[0] || CalendarApp.createCalendar(name);
  }
  return calendarCache_[name];
}

function requiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`${name} is not set in Script properties`);
  return value;
}

function loadState_(props) {
  const state = {};
  for (const [name, value] of Object.entries(props.getProperties())) {
    if (name.startsWith(STATE_PREFIX)) state[name.slice(STATE_PREFIX.length)] = JSON.parse(value);
  }
  return state;
}

function cellKey_(cell) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    [cell.studio.header, isoDate_(cell.date), cell.text].join('\u0000'),
    Utilities.Charset.UTF_8,
  );
  return Utilities.base64EncodeWebSafe(digest).slice(0, 22);
}

function describe_(cell) {
  return `${cell.studio.header} ${isoDate_(cell.date)} "${cell.text}"`;
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
