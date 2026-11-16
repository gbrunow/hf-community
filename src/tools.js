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
  /** @type {{ models?: { name: string, displayName: string, supportedGenerationMethods?: string[], thinking?: boolean }[] }} */
  const reply = JSON.parse(response.getContentText());
  const lines = (reply.models || [])
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

/** Logs the event color IDs the Calendar API accepts, with their hex, for CONFIG.EVENT_STYLES. */
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
    if (!Calendar?.Events) {
      throw new Error('Enable the Google Calendar API advanced service first.');
    }
    const { items = [] } = Calendar.Events.list(calendar.getId(), {
      timeMin: addDays_(today, -2).toISOString(),
      timeMax: addDays_(today, 14).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    const lines = items.map((item) => {
      const fields = /** @type {Record<string, unknown>} */ (item);
      const extra = Object.keys(fields).filter((key) => !standard.has(key));
      const extras = extra.map((key) => `${key}=${JSON.stringify(fields[key])}`);
      const start = item.start?.date || item.start?.dateTime;
      return `${start}  colorId=${item.colorId || '-'}  ${item.summary}${extras.length ? `  ${extras.join(' ')}` : ''}`;
    });
    console.log(`${studio.calendarName}:\n${lines.join('\n')}`);
  }
}

/**
 * Lists the events on each enabled studio's calendars (main and classes) for a day, with
 * the note each came from, or the whole description with `full`.
 * Run it with `npm run fn -- eventsOn -p '["2026-11-15"]'` (or `["2026-11-15",true]`).
 *
 * @param {string} iso YYYY-MM-DD
 * @param {boolean} [full] show each event's whole description
 * @returns {string[]}
 */
function eventsOn(iso, full = false) {
  const day = parseIsoDate_(iso);
  const lines = [];
  const names = CONFIG.STUDIOS.filter((s) => s.enabled).flatMap((s) =>
    s.classesCalendarName ? [s.calendarName, s.classesCalendarName] : [s.calendarName],
  );
  for (const name of names) {
    const calendar = CalendarApp.getCalendarsByName(name)[0];
    if (!calendar) continue;
    lines.push(`${name}:`);
    for (const event of calendar.getEventsForDay(day)) {
      const when = event.isAllDayEvent()
        ? 'all day'
        : `${event.getStartTime().toTimeString().slice(0, 5)}-${event.getEndTime().toTimeString().slice(0, 5)}`;
      const description = event.getDescription();
      const note = full ? description : description.split('\n\n').slice(0, 2).join(' ');
      lines.push(`  ${when.padEnd(11)} ${event.getTitle()}  <- ${note}`);
    }
  }
  return lines;
}

/**
 * Parses one made-up note with the real Gemini and returns what would become events,
 * writing nothing. Run it with `npm run fn -- tryParse -p '["2026-11-15","Bisque unload by 2pm"]'`.
 *
 * @param {string} iso YYYY-MM-DD, the day the note is for
 * @param {string} text
 * @returns {string}
 */
function tryParse(iso, text) {
  const studio = CONFIG.STUDIOS[0];
  const cell = /** @type {Cell} */ ({
    studio,
    date: parseIsoDate_(iso),
    dateLabel: iso,
    text,
    rowRange: '',
    sheetUrl: '',
    rowUrl: '',
  });
  const [parsed] = parseNotes_([cell], geminiModel_(true));
  return parsed ? describeParsed_(parsed) : '(no result)';
}

/**
 * The events-tab rows the script reads for a day, before Gemini sees them. Run it with
 * `npm run fn -- eventsTabRows -p '["2026-12-12"]'`.
 *
 * @param {string} iso YYYY-MM-DD
 * @returns {string[]}
 */
function eventsTabRows(iso) {
  const date = parseIsoDate_(iso);
  const window = { today: startOfDay_(new Date()), windowStart: date, windowEnd: date };
  return CONFIG.STUDIOS.filter((s) => s.enabled && s.eventsTab).flatMap((studio) =>
    readEventsTab_(studio, window).records.map(
      (record) => `${record.kind} row ${record.rowNumber}: ${JSON.stringify(record.fields)}`,
    ),
  );
}

/**
 * Sends the given days to Gemini exactly as a sync would and reports how many of the events
 * it returned lack a start or an end time, without writing anything. Run it with
 * `npm run fn -- tryEventDays -p '["classes",["2026-11-20","2026-11-21"]]'`.
 *
 * @param {'classes' | 'closures'} kind
 * @param {string[]} isoDates YYYY-MM-DD
 * @returns {string}
 */
function tryEventDays(kind, isoDates) {
  const studio = CONFIG.STUDIOS.find((s) => s.enabled && s.eventsTab);
  if (!studio) return 'No studio has an events tab.';
  const recordKinds = kind === 'classes' ? ['schedule'] : ['announcement', 'side'];
  const times = isoDates.map((iso) => parseIsoDate_(iso).getTime());
  const window = {
    today: startOfDay_(new Date()),
    windowStart: new Date(Math.min(...times)),
    windowEnd: new Date(Math.max(...times)),
  };
  const { records } = readEventsTab_(studio, window);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = isoDates.map((iso, id) => ({
    id,
    date: iso,
    weekday: weekdays[parseIsoDate_(iso).getDay()],
    rows: records
      .filter((r) => recordKinds.includes(r.kind) && isoDate_(r.date) === iso)
      .map((r) => r.fields),
  }));
  const reply = callGemini_({
    systemPrompt: kind === 'classes' ? CLASSES_PROMPT : CLOSURES_PROMPT,
    schema: EVENTS_SCHEMA,
    input: days,
    model: geminiModel_(true),
  });
  /** @type {{ title: string, start?: string, end?: string }[]} */
  const events = (reply.results || []).flatMap((/** @type {{ events?: RawDayEvent[] }} */ r) => r.events || []);
  const withoutTimes = events.filter((e) => !e.start || !e.end);
  return `${days.length} days sent, ${events.length} events back, ${withoutTimes.length} missing a start or an end` +
    (withoutTimes.length ? `; first: ${JSON.stringify(withoutTimes[0])}` : '');
}

/**
 * Finds events the script made that appear more than once (same title, start and calendar) on
 * the studios' calendars from yesterday through the longest look-ahead. Read-only; events
 * made by hand are ignored.
 *
 * @returns {string[]} one line per duplicated event, or a single line saying there are none
 */
function findDuplicateEvents() {
  const from = addDays_(startOfDay_(new Date()), -1);
  const to = addDays_(from, CONFIG.EVENTS_LOOKAHEAD_DAYS + 1);
  const names = CONFIG.STUDIOS.filter((s) => s.enabled).flatMap((s) =>
    s.classesCalendarName ? [s.calendarName, s.classesCalendarName] : [s.calendarName],
  );
  /** @type {string[]} */
  const lines = [];
  let checked = 0;
  for (const name of names) {
    const calendar = CalendarApp.getCalendarsByName(name)[0];
    if (!calendar) continue;
    /** @type {Record<string, number>} */
    const seen = {};
    for (const event of calendar.getEvents(from, to)) {
      if (!isScriptEvent_(event)) continue;
      checked++;
      const key = `${event.getStartTime().toISOString()} ${event.isAllDayEvent() ? 'all-day' : event.getEndTime().toISOString()} ${event.getTitle()}`;
      seen[key] = (seen[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(seen)) {
      if (count > 1) lines.push(`${name}: x${count} ${key}`);
    }
  }
  return lines.length ? lines : [`No duplicates among ${checked} events.`];
}

/**
 * Lists the events the script made on the studios' calendars that no stored item owns:
 * leftovers from a run that failed midway, or copies from two overlapping runs. Read-only;
 * it covers the sync window (older events are deliberately left on the calendar and
 * forgotten). Events made by hand are counted and left out. removeUntrackedEvents() deletes
 * what this lists.
 *
 * @returns {string[]} one line per untracked event, or a single line saying there are none
 */
function findUntrackedEvents() {
  const scan = scanCalendars_();
  const lines = scan.missing.map((name) => `${name}: no calendar by this name`);
  for (const { calendarName, event } of scan.untracked) {
    lines.push(`${calendarName}: ${isoDate_(new Date(event.getStartTime().getTime()))} ${event.getTitle()}`);
  }
  const manual = scan.manual.length ? `, ${scan.manual.length} made by hand and left alone` : '';
  return lines.length ? lines : [`Every one of ${scan.tracked} events the script made is tracked${manual}.`];
}

/**
 * Lists the hand-made events the script sees in the sync window, with the description each
 * has now. Read-only. Run it with `npm run fn -- handMadeEvents`.
 *
 * @returns {string[]}
 */
function handMadeEvents() {
  const { manual } = scanCalendars_();
  if (!manual.length) return ['No hand-made events in the sync window.'];
  return manual.map(
    ({ calendarName, event }) =>
      `${calendarName} | ${isoDate_(new Date(event.getStartTime().getTime()))} | ${event.getTitle()} | created ${event.getDateCreated().toISOString()}, last changed ${event.getLastUpdated().toISOString()}\n${event.getDescription() || '(no description)'}`,
  );
}
