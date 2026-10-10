/**
 * Syncs the studio kiln log (a Google Sheet) into one Google Calendar per studio.
 *
 * Every non-empty studio cell becomes one all-day event per kiln activity it mentions
 * ("Reduction unloaded", "Bisque loading"). Anything at a clock time ("unload by ~4pm",
 * "unload 10/10 by 11am") becomes a timed event instead.
 * Gemini parses the free-form notes; each cell is parsed once and remembered by a hash
 * of its content, so an edited cell has its events replaced and a cleared cell has
 * them removed.
 *
 * Setup:
 *   1. Project Settings → Script properties → add SOURCE_SPREADSHEET_ID (the long id in
 *      the source sheet's URL) and GEMINI_API_KEY. Kept out of the code so pasting in a
 *      new version doesn't wipe them. Optional overrides:
 *        GEMINI_MODEL           replaces CONFIG.DEFAULT_GEMINI_MODEL when Google retires a model.
 *        SYNC_INTERVAL_MINUTES  replaces CONFIG.DEFAULT_SYNC_INTERVAL_MINUTES; sync() picks
 *                               up a change on its next run.
 *        SYNC_MAX_DAYS_AHEAD    replaces CONFIG.DEFAULT_SYNC_MAX_DAYS_AHEAD.
 *        GEMINI_THINKING_LEVEL  replaces CONFIG.DEFAULT_GEMINI_THINKING_LEVEL; "default"
 *                               omits the setting, for models that don't accept it.
 *        GEMINI_PREVIEW_MODEL   used by preview() instead of the sync model, to try a
 *                               model out before switching GEMINI_MODEL to it.
 *   2. Project Settings → set the time zone to the studio's.
 *   3. Run preview() and check the log. Nothing is written.
 *   4. Run sync() once, then installTrigger().
 */

// Legacy event color ID owned by each calendar label, named after the label's color.
// Setting an event's color ID applies the label that owns it.
const eventColor = {
  graphite: 2, // #616161
  sage: 11, // #489160
  peacock: 6, // #4b99d2
  radicchio: 4, // #c05476
  mango: 1, // #e0963c
};

const CONFIG = {
  // One tab per year, found by a name containing this word and the year, case-insensitive
  // (e.g. "Kiln Notes 2026"). The year also supplies the one the date column leaves out.
  TAB_KEYWORD: 'kiln',
  // A disabled studio isn't read; its synced events inside the window are removed on the
  // next sync, like any cleared note. Older events and the calendar itself stay.
  STUDIOS: [
    {
      enabled: true,
      header: 'Downtown',
      calendarName: 'Higher Fire · Downtown',
      location: '499 S Market St, San Jose, CA 95113',
    },
    {
      enabled: true,
      header: 'JTown',
      calendarName: 'Higher Fire · JTown',
      location: '520 N 7th St, San Jose, CA 95112',
    },
  ],
  // Only this window is synced. Older rows keep their events but are never revisited,
  // so after-the-fact edits ("to be loaded" → "loaded") don't churn history.
  WINDOW_PAST_DAYS: 14,
  DEFAULT_SYNC_MAX_DAYS_AHEAD: 14, // Overridden by the SYNC_MAX_DAYS_AHEAD script property.
  TIMED_EVENT_MINUTES: 30,
  DEFAULT_SYNC_INTERVAL_MINUTES: 60, // Overridden by the SYNC_INTERVAL_MINUTES script property.
  DEFAULT_GEMINI_MODEL: 'gemini-3.5-flash-lite', // Overridden by the GEMINI_MODEL script property.
  // Extraction needs little reasoning; the model's own default took minutes per batch.
  // Overridden by the GEMINI_THINKING_LEVEL script property.
  DEFAULT_GEMINI_THINKING_LEVEL: 'low',
  // New notes are sent to Gemini in as few requests as this cap allows, split evenly
  // (130 notes → two requests of 65), so no request is a near-empty leftover.
  MAX_NOTES_PER_REQUEST: 100,
  // Apps Script kills a run at 6 minutes. Past this, no new Gemini request or event
  // creation starts; what's left is picked up by the next run.
  RUN_TIME_BUDGET_MS: 4 * 60 * 1000,
  // Calendar label per kiln stage, from the first pattern matching the event title (so
  // "unload" is checked before "load"). The API can't set a label directly: each label
  // owns one of the 11 legacy color IDs, and setting that ID applies it. An ID with no
  // label on a calendar is dropped, so every studio calendar needs these labels on these
  // IDs (Settings → the calendar → Event labels). Label names show only to editors;
  // subscribers see the colors. Apple Calendar ignores both.
  STAGES: [
    {
      name: 'Closure',
      pattern: /\bclos(ed|es|ing|ure)\b/i,
      colorId: eventColor.radicchio,
      emoji: '🔴',
    },
    {
      name: 'Unloading',
      pattern: /unload/i,
      colorId: eventColor.sage,
      emoji: '🟢',
    },
    {
      name: 'Cooling',
      pattern: /\bcool/i,
    },
    {
      name: 'Firing',
      pattern: /\bfir(e|ed|es|ing)\b/i,
    },
    {
      name: 'Loading',
      pattern: /\bload/i,
      colorId: eventColor.peacock,
      emoji: '🔵',
    },
  ],
  // Fine print closing every event's description and each calendar's, since most calendar
  // apps never show the calendar description. Plain text: Apple Calendar shows HTML
  // descriptions as raw tags.
  CONTACT: 'Community calendar by Gui Brunow (gbrunow@outlook.com).',
  DISCLAIMER: 'DISCLAIMER: Not an official Higher Fire calendar.',
  AI_NOTICE:
    'Events are generated by AI from the kiln notes and may contain mistakes; times ' +
    'are approximate.',
};

const STATE_PREFIX = 'cell:';
// The interval the current trigger was installed with; Apps Script can't report it.
const INSTALLED_INTERVAL_PROPERTY = 'trigger:intervalMinutes';
// The only intervals Apps Script time-based triggers support.
const ALLOWED_INTERVAL_MINUTES = [
  1, 5, 10, 15, 30, 60, 120, 240, 360, 480, 720,
];

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

const SYSTEM_PROMPT = `You read notes from a pottery studio's kiln log. Each note describes what
the kilns are doing on one day at one studio. The user message is a JSON list of notes, each
with an "id", its "date" and "weekday", and the "note" text. Reply with {"results": [...]}
holding exactly one result per note, with the note's "id" and:

- "activities": one short label per kiln activity or announcement in the note, in order,
  each of which becomes its own calendar event. Fix obvious typos and casing, and spell
  out kiln names: Redux/Rdx/Red → Reduction, Ox/Oxy → Oxidation, Bisq/Bisk → Bisque,
  E bisque → Electric bisque, Unldd → unloaded. Keep qualifiers and vague timing
  ("for Vasudha's class", "possibly in the afternoon"). Leave out anything you moved into
  "timed". Never add information.
- "timed": one item per thing that happens at a specific clock time. Approximate times
  count ("~4pm", "6 ish", "around 5pm"). Each item has:
  - "title": a short label such as "Bisque unload".
  - "date": YYYY-MM-DD. Use the note's date unless the note names another date; "10/10"
    means October 10 of the nearest year.
  - "time": HH:MM, 24-hour. An hour without am/pm falls within studio hours, 09:00-21:59,
    so "6 ish" is 18:00.
  Vague timing ("in PM", "later", "possible unload") is not a timed item. Use an empty
  list when there are none.

Examples, note → result:
{"id":0,"date":"2026-10-09","weekday":"Fri","note":"Bisque Loading, reduction cooling (unload 10/10 by 11am)"}
→ {"id":0,"activities":["Bisque loading","Reduction cooling"],"timed":[{"title":"Reduction unload","date":"2026-10-10","time":"11:00"}]}
{"id":1,"date":"2026-06-05","weekday":"Fri","note":"Reduction late unload (by 6 ish), bisque loading"}
→ {"id":1,"activities":["Bisque loading"],"timed":[{"title":"Reduction unload (late)","date":"2026-06-05","time":"18:00"}]}
{"id":2,"date":"2026-10-10","weekday":"Sat","note":"reduction to be cooled, possible unload in PM"}
→ {"id":2,"activities":["Reduction cooling","Reduction possibly unloaded in the afternoon"],"timed":[]}
{"id":3,"date":"2026-10-02","weekday":"Fri","note":"Reduction unloaded, Bisque loading, Lowfire bisque for Vasudha's class loaded"}
→ {"id":3,"activities":["Reduction unloaded","Bisque loading","Lowfire bisque loaded (Vasudha's class)"],"timed":[]}`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER' },
          activities: { type: 'ARRAY', items: { type: 'STRING' } },
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
        required: ['id', 'activities', 'timed'],
      },
    },
  },
  required: ['results'],
};

/**
 * Logs what sync() would do, over a wider past window so there's more to look at.
 * Declared first so it's the editor's default Run target.
 */
function preview() {
  run_({ dryRun: true, pastDays: 14 });
}

function sync() {
  reconcileTrigger_();
  run_({ dryRun: false, pastDays: CONFIG.WINDOW_PAST_DAYS });
}

function forceSync() {
  reset();
  sync();
}

/**
 * Logs a one-tap webcal:// subscribe link for each enabled studio's calendar. The links
 * only work once the calendar is public (Settings → the calendar → Access permissions →
 * Make available to public); scripts can't read the private secret address.
 */
function subscribeLinks() {
  for (const studio of CONFIG.STUDIOS.filter((s) => s.enabled)) {
    const calendar = CalendarApp.getCalendarsByName(studio.calendarName)[0];
    if (!calendar) {
      console.log(`${studio.calendarName}: not created yet; run sync() first.`);
      continue;
    }
    const link = subscribeUrl_(calendar);
    // Fetched without your sign-in, so it only succeeds if the calendar is public.
    const feed = UrlFetchApp.fetch(link.replace(/^webcal:/, 'https:'), {
      muteHttpExceptions: true,
    });
    const isPublic =
      feed.getResponseCode() === 200 &&
      feed.getContentText().startsWith('BEGIN:VCALENDAR');
    console.log(
      `${studio.calendarName}: ${link}` +
        (isPublic
          ? ''
          : "\n  Not public yet, so this link won't work until it is."),
    );
  }
}

function installTrigger() {
  const minutes = syncIntervalMinutes_();
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'sync')
      ScriptApp.deleteTrigger(trigger);
  }
  const builder = ScriptApp.newTrigger('sync').timeBased();
  (minutes < 60
    ? builder.everyMinutes(minutes)
    : builder.everyHours(minutes / 60)
  ).create();
  PropertiesService.getScriptProperties().setProperty(
    INSTALLED_INTERVAL_PROPERTY,
    String(minutes),
  );
  console.log(`Installed the sync trigger: every ${minutes} minutes.`);
}

/** Reinstalls the trigger when SYNC_INTERVAL_MINUTES no longer matches it. */
function reconcileTrigger_() {
  const hasTrigger = ScriptApp.getProjectTriggers().some(
    (trigger) => trigger.getHandlerFunction() === 'sync',
  );
  if (!hasTrigger) return; // Never installed: sync() is being run by hand.
  const installed = Number(
    PropertiesService.getScriptProperties().getProperty(
      INSTALLED_INTERVAL_PROPERTY,
    ),
  );
  if (installed !== syncIntervalMinutes_()) installTrigger();
}

function syncIntervalMinutes_() {
  const value = PropertiesService.getScriptProperties().getProperty(
    'SYNC_INTERVAL_MINUTES',
  );
  const minutes = value ? Number(value) : CONFIG.DEFAULT_SYNC_INTERVAL_MINUTES;
  if (!ALLOWED_INTERVAL_MINUTES.includes(minutes)) {
    throw new Error(
      `SYNC_INTERVAL_MINUTES is "${value}"; it must be one of ${ALLOWED_INTERVAL_MINUTES.join(', ')}`,
    );
  }
  return minutes;
}

function syncMaxDaysAhead_() {
  const value = PropertiesService.getScriptProperties().getProperty(
    'SYNC_MAX_DAYS_AHEAD',
  );
  const days = value ? Number(value) : CONFIG.DEFAULT_SYNC_MAX_DAYS_AHEAD;
  if (!Number.isInteger(days) || days < 0 || days > 366) {
    throw new Error(
      `SYNC_MAX_DAYS_AHEAD is "${value}"; it must be a whole number from 0 to 366`,
    );
  }
  return days;
}

/**
 * Deletes every event this script created and forgets every cell, so the next sync()
 * rebuilds from scratch. Use after renaming calendars or changing how events look.
 */
function reset() {
  const props = PropertiesService.getScriptProperties();
  let events = 0;
  for (const [key, entry] of Object.entries(loadState_(props))) {
    deleteEvents_(entry);
    events += entry.ids.length;
    props.deleteProperty(STATE_PREFIX + key);
  }
  console.log(`Reset: deleted ${events} event(s). Run sync() to rebuild.`);
}

/**
 * Logs the text models this API key can call, for picking a GEMINI_MODEL value. Doesn't
 * count against the generation quota.
 */
function listModels() {
  const response = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    {
      headers: { 'x-goog-api-key': requiredProperty_('GEMINI_API_KEY') },
      muteHttpExceptions: true,
    },
  );
  if (response.getResponseCode() !== 200) {
    throw new Error(
      `Gemini HTTP ${response.getResponseCode()}: ${response.getContentText().slice(0, 300)}`,
    );
  }
  const lines = (JSON.parse(response.getContentText()).models || [])
    .filter((m) =>
      (m.supportedGenerationMethods || []).includes('generateContent'),
    )
    .map(
      (m) =>
        `${m.name.replace(/^models\//, '')} — ${m.displayName}` +
        (m.thinking ? ' (thinking)' : ''),
    );
  console.log(
    `${lines.length} models support generateContent:\n${lines.join('\n')}`,
  );
}

/** Logs the event color IDs the Calendar API accepts, with their hex, for CONFIG.STAGES. */
function listEventColors() {
  const response = UrlFetchApp.fetch(
    'https://www.googleapis.com/calendar/v3/colors',
    {
      headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
      muteHttpExceptions: true,
    },
  );
  if (response.getResponseCode() !== 200) {
    throw new Error(
      `Calendar HTTP ${response.getResponseCode()}: ${response.getContentText().slice(0, 300)}`,
    );
  }
  const colors = JSON.parse(response.getContentText()).event || {};
  const lines = Object.entries(colors).map(
    ([id, { background }]) => `${id.padStart(2)}  ${background}`,
  );
  console.log(`${lines.length} event colors (id, hex):\n${lines.join('\n')}`);
}

/**
 * Logs each upcoming event's colorId and any non-standard fields, to see how a label set
 * in the Google Calendar UI is stored. Needs the Google Calendar API advanced service.
 */
function inspectEventColors() {
  const standard = new Set([
    'kind',
    'etag',
    'id',
    'status',
    'htmlLink',
    'created',
    'updated',
    'summary',
    'description',
    'creator',
    'organizer',
    'start',
    'end',
    'iCalUID',
    'sequence',
    'reminders',
    'eventType',
    'colorId',
    'transparency',
    'visibility',
    'location',
    'attendees',
    'extendedProperties',
    'guestsCanInviteOthers',
    'privateCopy',
    'source',
    'recurringEventId',
    'originalStartTime',
    'endTimeUnspecified',
  ]);
  const today = startOfDay_(new Date());
  for (const studio of CONFIG.STUDIOS) {
    const calendar = CalendarApp.getCalendarsByName(studio.calendarName)[0];
    if (!calendar) continue;
    const { items = [] } = Calendar.Events.list(calendar.getId(), {
      timeMin: addDays_(today, -2).toISOString(),
      timeMax: addDays_(today, 14).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    const lines = items.map((item) => {
      const extra = Object.keys(item).filter((key) => !standard.has(key));
      const extras = extra.map((key) => `${key}=${JSON.stringify(item[key])}`);
      return `${item.start.date || item.start.dateTime}  colorId=${item.colorId || '-'}  ${item.summary}${extras.length ? `  ${extras.join(' ')}` : ''}`;
    });
    console.log(`${studio.calendarName}:\n${lines.join('\n')}`);
  }
}

function run_({ dryRun, pastDays }) {
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > CONFIG.RUN_TIME_BUDGET_MS;
  const today = startOfDay_(new Date());
  const windowStart = addDays_(today, -pastDays);
  const windowEnd = addDays_(today, syncMaxDaysAhead_());

  const props = PropertiesService.getScriptProperties();
  const state = loadState_(props);
  const seen = new Set();
  const counts = {
    cells: 0,
    unchanged: 0,
    added: 0,
    events: 0,
    removed: 0,
    failed: 0,
    deferred: 0,
  };

  const model = geminiModel_(dryRun);
  const fresh = [];
  for (const cell of readCells_(today, windowStart, windowEnd)) {
    counts.cells++;
    const key = cellKey_(cell);
    seen.add(key);
    if (state[key]) {
      counts.unchanged++;
    } else {
      fresh.push({ cell, key });
    }
  }

  const batchSize = Math.ceil(
    fresh.length / Math.ceil(fresh.length / CONFIG.MAX_NOTES_PER_REQUEST),
  );
  batches: for (let start = 0; start < fresh.length; start += batchSize) {
    if (outOfTime()) {
      counts.deferred += fresh.length - start;
      break;
    }
    const batch = fresh.slice(start, start + batchSize);
    let results;
    try {
      results = parseNotes_(
        batch.map(({ cell }) => cell),
        model,
      );
    } catch (e) {
      // Later batches would most likely hit the same error (usually a rate limit), so
      // leave everything left for the next run.
      console.error(
        `Skipping ${fresh.length - start} note(s) until the next run: ${e.message}`,
      );
      counts.failed += fresh.length - start;
      break;
    }

    for (const [id, { cell, key }] of batch.entries()) {
      if (outOfTime()) {
        counts.deferred += fresh.length - (start + id);
        break batches;
      }
      const parsed = results[id];
      if (!parsed) {
        console.error(
          `Skipping ${describe_(cell)}: missing from Gemini's reply`,
        );
        counts.failed++;
        continue;
      }

      counts.added++;
      counts.events += parsed.activities.length + parsed.timed.length;
      console.log(
        `${dryRun ? 'Would add' : 'Added'} ${describe_(cell)}\n  → ${describeParsed_(parsed)}`,
      );
      if (dryRun) continue;

      const ids = createEvents_(
        getCalendar_(cell.studio.calendarName, cell.sheetUrl),
        cell,
        parsed,
      );
      props.setProperty(
        STATE_PREFIX + key,
        JSON.stringify({
          calendarName: cell.studio.calendarName,
          date: isoDate_(cell.date),
          ids,
        }),
      );
    }
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
    counts.removed += entry.ids.length;
    console.log(
      `${dryRun ? 'Would remove' : 'Removed'} ${entry.ids.length} event(s) for ${entry.calendarName} ${entry.date}`,
    );
    if (dryRun) continue;
    deleteEvents_(entry);
    props.deleteProperty(STATE_PREFIX + key);
  }

  console.log(
    `${dryRun ? 'Preview' : 'Sync'} of ${isoDate_(windowStart)} to ${isoDate_(windowEnd)}: ` +
      `${counts.cells} cells, ${counts.unchanged} unchanged, ${counts.added} new ` +
      `(${counts.events} events ${dryRun ? 'to add' : 'added'}), ` +
      `${counts.removed} events ${dryRun ? 'to remove' : 'removed'}, ${counts.failed} failed` +
      (counts.deferred
        ? `, ${counts.deferred} left for the next run (out of time).`
        : '.') +
      (counts.added || counts.failed ? ` Model: ${model}.` : ''),
  );
}

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

function geminiModel_(forPreview) {
  const props = PropertiesService.getScriptProperties();
  return (
    (forPreview && props.getProperty('GEMINI_PREVIEW_MODEL')) ||
    props.getProperty('GEMINI_MODEL') ||
    CONFIG.DEFAULT_GEMINI_MODEL
  );
}

/**
 * Parses a batch of notes in one Gemini request. Returns results indexed like `cells`;
 * a note missing from the reply is left undefined.
 */
function parseNotes_(cells, model) {
  const apiKey = requiredProperty_('GEMINI_API_KEY');
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const notes = cells.map((cell, id) => ({
    id,
    date: isoDate_(cell.date),
    weekday: weekdays[cell.date.getDay()],
    note: cell.text,
  }));
  const thinkingLevel =
    PropertiesService.getScriptProperties().getProperty(
      'GEMINI_THINKING_LEVEL',
    ) || CONFIG.DEFAULT_GEMINI_THINKING_LEVEL;
  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
  };
  if (thinkingLevel !== 'default') {
    generationConfig.thinkingConfig = { thinkingLevel };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const request = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(notes) }] }],
      generationConfig,
    }),
  };

  let response;
  for (let attempt = 1; ; attempt++) {
    response = UrlFetchApp.fetch(url, request);
    const code = response.getResponseCode();
    // Only server errors are retried. A 429 means the quota is spent, which waiting
    // seconds won't fix, and the next scheduled run retries anyway.
    if (code < 500 || attempt === 3) break;
    console.warn(
      `Gemini HTTP ${code} on attempt ${attempt}; retrying in ${10 * attempt}s`,
    );
    Utilities.sleep(10000 * attempt);
  }
  if (response.getResponseCode() !== 200) {
    throw new Error(
      `Gemini HTTP ${response.getResponseCode()}: ${response.getContentText().slice(0, 300)}`,
    );
  }

  const body = JSON.parse(response.getContentText());
  // Skip thought parts, which some models return alongside the answer.
  const text = body.candidates[0].content.parts
    .filter((part) => !part.thought)
    .map((part) => part.text)
    .join('');
  const results = [];
  for (const result of JSON.parse(text).results || []) {
    const cell = cells[result.id];
    if (cell && !results[result.id]) {
      results[result.id] = validateParsed_(result, cell);
    }
  }
  return results;
}

/**
 * Drops timed items the model got malformed or placed implausibly far from the row, and
 * falls back to the raw note when nothing usable is left.
 */
function validateParsed_(parsed, cell) {
  const activities = (parsed.activities || [])
    .map((activity) => String(activity).trim())
    .filter(Boolean);
  const timed = (parsed.timed || []).filter((item) => {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)
    ) {
      return false;
    }
    const daysAway = Math.abs(parseIsoDate_(item.date) - cell.date) / 86400000;
    return daysAway <= 7;
  });
  if (!activities.length && !timed.length) activities.push(cell.text);
  return { activities, timed };
}

function createEvents_(calendar, cell, parsed) {
  const description = [
    `Original note (${cell.dateLabel}):`,
    `"${cell.text}"\n${cell.rowUrl}`,
    RULE,
    shareSection_(calendar),
    RULE,
    CONFIG.DISCLAIMER,
    `${CONFIG.AI_NOTICE} Check the original note before relying on an event.`,
  ].join('\n\n');
  const options = { description, location: cell.studio.location };
  // A stage's optional emoji prefixes the title, carrying the stage to clients that
  // ignore event colors (Apple Calendar).
  const titled = (title) => {
    const stage = stageOf_(title);
    return { stage, title: stage?.emoji ? `${stage.emoji} ${title}` : title };
  };
  const events = [];
  for (const activity of parsed.activities) {
    const { stage, title } = titled(activity);
    events.push({
      stage,
      event: calendar.createAllDayEvent(title, cell.date, options),
    });
  }
  for (const item of parsed.timed) {
    const start = dateAt_(item.date, item.time);
    const end = new Date(start.getTime() + CONFIG.TIMED_EVENT_MINUTES * 60000);
    const { stage, title } = titled(item.title);
    events.push({
      stage,
      event: calendar.createEvent(title, start, end, options),
    });
  }
  for (const { stage, event } of events) {
    if (stage?.colorId) event.setColor(String(stage.colorId));
  }
  return events.map(({ event }) => event.getId());
}

function stageOf_(title) {
  return CONFIG.STAGES.find((stage) => stage.pattern.test(title)) || null;
}

/** "Bisque loading [Loading] · 2026-10-10 11:00 Reduction unload [Unloaded]" */
function describeParsed_(parsed) {
  const label = (title) => `${title} [${stageOf_(title)?.name || 'no stage'}]`;
  return [
    ...parsed.activities.map(label),
    ...parsed.timed.map(
      (item) => `${item.date} ${item.time} ${label(item.title)}`,
    ),
  ].join(' · ');
}

function deleteEvents_(entry) {
  const calendar = CalendarApp.getCalendarsByName(entry.calendarName)[0];
  if (!calendar) return;
  for (const id of entry.ids) {
    const event = calendar.getEventById(id);
    if (event) event.deleteEvent(); // Null if it was already deleted by hand.
  }
}

// The most that fit on one line in Apple Calendar's event details on iPhone.
const RULE = '─'.repeat(19);

function shareSection_(calendar) {
  return `${CONFIG.CONTACT}\n\nShare this calendar:\n${subscribeUrl_(calendar)}`;
}

const calendarCache_ = {};

/** The calendar's public iCal feed as a webcal:// link, which opens a subscribe prompt. */
function subscribeUrl_(calendar) {
  return `webcal://calendar.google.com/calendar/ical/${encodeURIComponent(calendar.getId())}/public/basic.ics`;
}

function getCalendar_(name, sheetUrl) {
  if (!calendarCache_[name]) {
    const calendar =
      CalendarApp.getCalendarsByName(name)[0] ||
      CalendarApp.createCalendar(name);
    const description = [
      shareSection_(calendar),
      RULE,
      CONFIG.DISCLAIMER,
      `${CONFIG.AI_NOTICE} Check the kiln notes before relying on an event:\n${sheetUrl}`,
    ].join('\n\n');
    if (calendar.getDescription() !== description)
      calendar.setDescription(description);
    calendarCache_[name] = calendar;
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
    if (name.startsWith(STATE_PREFIX))
      state[name.slice(STATE_PREFIX.length)] = JSON.parse(value);
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
