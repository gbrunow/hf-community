/**
 * The studios' discard schedules: one item per studio, the whole tab, read by Gemini into
 * the dates unclaimed work is discarded. An item belongs to no single day, so it stays
 * until the tab's content changes, then its events are replaced.
 */

const DISCARD_STATE_PREFIX = 'discard:';

const DISCARD_PROMPT = `You read a pottery studio's work discard schedule: one tab of a spreadsheet, given
as text with one row per line and the cells of a row separated by " | ". The user message is
JSON with the tab's "text".

Find every date on which unclaimed work will be discarded, for each type of work. Reply with
{"groups": [...]}, one group per type of work that has dates, with:

- "workType": the type of work as the schedule names it, without a trailing colon
  ("Bisque", "Glazed Fired Work").
- "dates": the discard dates listed for that type, in the order the schedule lists them.
  Dates may be written as 9/14/2026, as "Oct 1", or as a list joined by commas or arrows.
  Each has "month" (1-12), "day" (1-31) and, only when the schedule writes a year, "year"
  (four digits).

List only discard dates. Hold times ("2 months") and other numbers are not dates. A type
that is only described ("Ongoing - work is checked weekly") has no dates and gets no group.
Never add, infer or complete a date, and never guess a year.

Examples, text → reply:
"Bisque: | Oct 1 →  Dec 1→  Feb 1\\nGreenware: | Ongoing - work is checked weekly"
→ {"groups":[{"workType":"Bisque","dates":[{"month":10,"day":1},{"month":12,"day":1},{"month":2,"day":1}]}]}
"Glazed Fired Work: | 9/14/2026 | 11/13/2026"
→ {"groups":[{"workType":"Glazed Fired Work","dates":[{"month":9,"day":14,"year":2026},{"month":11,"day":13,"year":2026}]}]}`;

const DISCARD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    groups: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          workType: { type: 'STRING' },
          dates: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                month: { type: 'INTEGER' },
                day: { type: 'INTEGER' },
                year: { type: 'INTEGER' },
              },
              required: ['month', 'day'],
            },
          },
        },
        required: ['workType', 'dates'],
      },
    },
  },
  required: ['groups'],
};

/** @returns {Source<DiscardTab, DiscardResult>} */
function discardSource_() {
  return {
    name: 'discard',
    statePrefix: DISCARD_STATE_PREFIX,
    read: readDiscardTabs_,
    parse: (tabs, model) => tabs.map((tab) => parseDiscardTab_(tab, model)),
    createEvents: createDiscardEvents_,
    describe: (result) =>
      result.events.map((e) => `${e.date} ${e.title}`).join(' · ') ||
      '(no upcoming discard dates)',
    countEvents: (result) => result.events.length,
  };
}

/**
 * A studio without a discard tab is skipped with a warning, so its events are removed like
 * any item that vanished; failing the run would stop the kiln notes from syncing.
 *
 * @param {SyncWindow} window
 * @returns {Item<DiscardTab>[]}
 */
function readDiscardTabs_({ today }) {
  const spreadsheet = SpreadsheetApp.openById(
    requiredProperty_('SOURCE_SPREADSHEET_ID'),
  );
  const sheetUrl = spreadsheetUrl_(spreadsheet);
  const sheets = spreadsheet.getSheets();
  /** @type {Item<DiscardTab>[]} */
  const items = [];
  for (const studio of CONFIG.STUDIOS.filter((s) => s.enabled)) {
    const sheet = findDiscardTab_(sheets, studio);
    if (!sheet) {
      console.warn(
        `No discard schedule tab for ${studio.header}; its discard events are removed.`,
      );
      continue;
    }
    const text = tabText_(sheet);
    const gid = sheet.getSheetId();
    items.push({
      key: hashKey_([studio.header, text]),
      date: null,
      calendarName: studio.calendarName,
      sheetUrl,
      label: `${studio.header} discard schedule`,
      payload: {
        studio,
        tabName: sheet.getName().trim(),
        tabUrl: `${sheetUrl}?gid=${gid}#gid=${gid}`,
        text,
        today,
      },
    });
  }
  return items;
}

/**
 * Throws on more than one match (e.g. a "Copy of" tab) rather than guess which is live.
 *
 * @param {SheetTab[]} sheets
 * @param {Studio} studio
 * @returns {SheetTab | null}
 */
function findDiscardTab_(sheets, studio) {
  const matches = sheets.filter((sheet) => studio.discardTab.test(sheet.getName()));
  if (matches.length > 1) {
    throw new Error(
      `Several tabs match ${studio.header}'s discard schedule: ${matches.map((s) => `"${s.getName()}"`).join(', ')}`,
    );
  }
  return matches[0] || null;
}

/**
 * @param {SheetTab} sheet
 * @returns {string} one line per non-empty row, its non-empty cells joined with " | "
 */
function tabText_(sheet) {
  return sheet
    .getDataRange()
    .getDisplayValues()
    .map((row) =>
      row
        .map((cell) => String(cell).trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .join(' | '),
    )
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {DiscardTab} tab
 * @param {string} model
 * @returns {DiscardResult}
 */
function parseDiscardTab_(tab, model) {
  /** @type {RawDiscard} */
  const reply = callGemini_({
    systemPrompt: DISCARD_PROMPT,
    schema: DISCARD_SCHEMA,
    input: { text: tab.text },
    model,
  });
  return discardEvents_(reply, tab.today, tab.studio.header);
}

/**
 * Turns Gemini's dates into events: one per upcoming date, naming every type of work
 * discarded that day. Warns when the tab yields nothing to schedule.
 *
 * @param {RawDiscard} reply
 * @param {Date} today
 * @param {string} studioName for warnings
 * @returns {DiscardResult}
 */
function discardEvents_(reply, today, studioName) {
  /** @type {Map<string, string[]>} */
  const typesByDate = new Map();
  let found = 0;
  for (const group of reply.groups || []) {
    const workType = String(group.workType ?? '').trim() || 'Work';
    for (const date of resolveDiscardDates_(group.dates || [], today, studioName)) {
      found++;
      if (date < today) continue;
      const iso = isoDate_(date);
      const types = typesByDate.get(iso) || [];
      if (!types.includes(workType)) types.push(workType);
      typesByDate.set(iso, types);
    }
  }
  if (!found) {
    console.warn(`${studioName}: no discard dates found in the schedule tab.`);
  } else if (!typesByDate.size) {
    console.warn(
      `${studioName}: every discard date is in the past; the schedule may be out of date.`,
    );
  }
  const events = [...typesByDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, types]) => ({ date, title: `Discard day: ${types.join(', ')}` }));
  return { events };
}

/**
 * Gives each listed date its year. A written year is used as is. A list is chronological,
 * so a date without one follows the date before it, and the first is its nearest
 * occurrence to today. Invalid dates (Feb 30) are skipped with a warning.
 *
 * @param {RawDiscardDate[]} dates in the order the schedule lists them
 * @param {Date} today
 * @param {string} studioName for warnings
 * @returns {Date[]}
 */
function resolveDiscardDates_(dates, today, studioName) {
  /** @type {Date[]} */
  const resolved = [];
  /** @type {Date | null} */
  let previous = null;
  for (const { month, day, year } of dates) {
    if (!month || !day) {
      console.warn(`${studioName}: skipped a discard date without a month and day.`);
      continue;
    }
    /** @type {Date | null} */
    let date;
    if (year) {
      date = new Date(year, month - 1, day);
    } else if (!previous) {
      date = nearestOccurrence_(month, day, today);
    } else {
      date = new Date(previous.getFullYear(), month - 1, day);
      if (date <= previous) date = new Date(previous.getFullYear() + 1, month - 1, day);
    }
    if (!date || date.getMonth() !== month - 1 || date.getDate() !== day) {
      console.warn(`${studioName}: skipped an invalid discard date ${month}/${day}.`);
      continue;
    }
    resolved.push(date);
    previous = date;
  }
  return resolved;
}

/**
 * The date with this month and day closest to today, looking a year either way.
 *
 * @param {number} month 1-12
 * @param {number} day
 * @param {Date} today
 * @returns {Date | null} null when no nearby year has that date (Feb 29)
 */
function nearestOccurrence_(month, day, today) {
  /** @type {Date | null} */
  let best = null;
  for (const year of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1) continue;
    const distance = Math.abs(date.getTime() - today.getTime());
    if (!best || distance <= Math.abs(best.getTime() - today.getTime())) best = date;
  }
  return best;
}

/**
 * @param {StudioCalendar} calendar
 * @param {DiscardTab} tab
 * @param {DiscardResult} result
 * @returns {string[]}
 */
function createDiscardEvents_(calendar, tab, result) {
  const description = eventDescription_(
    calendar,
    `Original schedule (${tab.tabName}):\n${tab.tabUrl}`,
    'Check the original schedule before relying on an event.',
  );
  return result.events.map(({ date, title }) =>
    calendar
      .createAllDayEvent(title, parseIsoDate_(date), {
        description,
        location: tab.studio.location,
      })
      .getId(),
  );
}
