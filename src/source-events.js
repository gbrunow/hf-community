/**
 * The events tab becomes two sources, because they go to different calendars: class
 * sessions (rows with an event name) to the studio's classes calendar, and closures and
 * workshops (announcement rows and the side table) to its main calendar. Gemini reads the
 * rows into events, copying times and counts as written; the code checks them against the
 * row, and builds titles and descriptions itself.
 */

const CLASSES_STATE_PREFIX = 'classes:';
const CLOSURES_STATE_PREFIX = 'closures:';

const EVENTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER' },
          events: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                title: { type: 'STRING' },
                start: { type: 'STRING' },
                end: { type: 'STRING' },
                wheels: { type: 'STRING' },
                handBuilding: { type: 'STRING' },
              },
              required: ['title', 'start', 'end', 'wheels', 'handBuilding'],
            },
          },
        },
        required: ['id', 'events'],
      },
    },
  },
  required: ['results'],
};

const CLASSES_PROMPT = `You read rows of a pottery studio's class schedule. The user message is a JSON list of
days, each with an "id", its "date" and "weekday", and its "rows": one object per class
session, keyed by the sheet's column headers (such as "Start", "End", "Event", "# of Wheels",
"Hand-building"); a cell that is empty is left out. Reply with {"results": [...]} holding
exactly one result per day, with the day's "id" and its "events": one event per row, in
order. Each event has:

- "title": the class name from the "Event" column. Fix obvious typos, and keep everything
  else as written.
- "start" and "end": HH:MM, 24-hour. Class times fall within studio hours, 09:00-21:59, so a
  time written before 9 AM (such as "3:00 AM") is a typo for the same hour in the afternoon.
  Use "" for both when the row has no usable start and end.
- "wheels": the "# of Wheels" cell copied exactly as written; "" when the row has none.
- "handBuilding": the "Hand-building" cell copied exactly as written; "" when the row has
  none.

Every event has all five fields. Never add information, and never change a number.

Example, day → result:
{"id":0,"date":"2026-09-05","weekday":"Sat","rows":[{"Start":"3:00 AM","End":"5:00 AM","Event":"Take a Spin","# of Wheels":"6"},{"Start":"10:00 AM","End":"12:00 PM","Event":"Let's Roll","Hand-building":"8 seats plus tools"}]}
→ {"id":0,"events":[{"title":"Take a Spin","start":"15:00","end":"17:00","wheels":"6","handBuilding":""},{"title":"Let's Roll","start":"10:00","end":"12:00","wheels":"","handBuilding":"8 seats plus tools"}]}`;

const CLOSURES_PROMPT = `You read announcements from a pottery studio's event sheet: closures, early closings and
workshops. The user message is a JSON list of days, each with an "id", its "date" and
"weekday", and its "rows": one object per announcement, keyed by the sheet's column headers
(such as "Start" and "End") or "Side table"; the text of an announcement can sit in any of
those cells. Reply with {"results": [...]} holding exactly one result per day, with the day's
"id" and its "events": one event per announcement, in order. Each event has:

- "title": the announcement as a short title that keeps what and when ("Studio closed for
  Memorial Day", "Studio closing at 4pm for workshop set up", "Extruder 1 with Sam Rivera").
  Fix obvious typos and use sentence case. Never add information.
- "start" and "end": HH:MM, 24-hour. A workshop or event with a start and an end time gives
  both ("10am-1pm" is 10:00 to 13:00). A closure that begins at a time ("closed at 3:30",
  "closing at 4pm") gives that time as "start" and "" for "end"; it lasts to the end of the
  day. Use "" for both for anything else. An hour without am/pm falls within studio hours,
  09:00-21:59, so "3:30" is 15:30.
- "wheels": the number of wheels, copied exactly as written, when the announcement gives
  one; otherwise "".
- "handBuilding": the hand-building area, copied exactly as written (such as
  "Hand-building"), when the announcement names one; otherwise "".

Every event has all five fields.

Examples, day → result:
{"id":0,"date":"2026-05-25","weekday":"Mon","rows":[{"Start":"STUDIO CLOSED FOR MEMORIAL DAY"}]}
→ {"id":0,"events":[{"title":"Studio closed for Memorial Day","start":"","end":"","wheels":"","handBuilding":""}]}
{"id":1,"date":"2026-01-10","weekday":"Sat","rows":[{"Side table":"Sat, Jan 10 | 10am-1pm | Extruder 1 with Sam Rivera | Hand-building"}]}
→ {"id":1,"events":[{"title":"Extruder 1 with Sam Rivera","start":"10:00","end":"13:00","wheels":"","handBuilding":"Hand-building"}]}
{"id":2,"date":"2026-11-25","weekday":"Wed","rows":[{"Start":"CLOSED AT 3:30 FOR THANKSGIVING"}]}
→ {"id":2,"events":[{"title":"Closed at 3:30 for Thanksgiving","start":"15:30","end":"","wheels":"","handBuilding":""}]}`;

/** @returns {Source<EventsPayload, EventsResult>} */
function classesSource_() {
  return eventsSource_({
    name: 'classes',
    statePrefix: CLASSES_STATE_PREFIX,
    recordKinds: ['schedule'],
    prompt: CLASSES_PROMPT,
    lookaheadDays: CONFIG.CLASSES_LOOKAHEAD_DAYS,
  });
}

/** @returns {Source<EventsPayload, EventsResult>} */
function closuresSource_() {
  return eventsSource_({
    name: 'closures',
    statePrefix: CLOSURES_STATE_PREFIX,
    recordKinds: ['announcement', 'side'],
    prompt: CLOSURES_PROMPT,
    lookaheadDays: CONFIG.EVENTS_LOOKAHEAD_DAYS,
  });
}

/**
 * @param {{ name: 'classes' | 'closures', statePrefix: string, recordKinds: string[], prompt: string, lookaheadDays: number }} options
 * @returns {Source<EventsPayload, EventsResult>}
 */
function eventsSource_(options) {
  return {
    name: options.name,
    statePrefix: options.statePrefix,
    lookaheadDays: options.lookaheadDays,
    usesModel: true,
    maxItemsPerRequest: CONFIG.EVENTS_DAYS_PER_REQUEST,
    read: (window) => readEventDays_(options, window),
    parse: (payloads, model) => parseEventDays_(payloads, model, options.prompt),
    createEvents: createDayEvents_,
    describe: (result) =>
      result.events
        .map((event) => `${event.start ? `${event.start}-${event.end} ` : ''}${eventTitle_(event)}`)
        .join(' · '),
    countEvents: (result) => result.events.length,
  };
}

/**
 * One item per studio and day, from that studio's events tab.
 *
 * @param {{ name: 'classes' | 'closures', recordKinds: string[] }} options
 * @param {SyncWindow} window
 * @returns {Item<EventsPayload>[]}
 */
function readEventDays_(options, window) {
  /** @type {Item<EventsPayload>[]} */
  const items = [];
  for (const studio of CONFIG.STUDIOS.filter((s) => s.enabled && s.eventsTab)) {
    const calendarName =
      options.name === 'classes' ? studio.classesCalendarName : studio.calendarName;
    if (!calendarName) continue;
    const { records, sheetUrl } = readEventsTab_(studio, window);
    /** @type {Map<string, EventsRecord[]>} */
    const days = new Map();
    for (const record of records) {
      if (!options.recordKinds.includes(record.kind)) continue;
      const iso = isoDate_(record.date);
      days.set(iso, [...(days.get(iso) || []), record]);
    }
    for (const [iso, dayRecords] of days) {
      items.push({
        key: hashKey_([
          options.name,
          studio.header,
          iso,
          JSON.stringify(dayRecords.map((r) => r.fields)),
        ]),
        date: dayRecords[0].date,
        calendarName,
        sheetUrl,
        label: `${studio.header} ${options.name} ${iso}`,
        payload: {
          studio,
          kind: options.name,
          iso,
          dateLabel: dayRecords[0].dateLabel,
          records: dayRecords,
        },
      });
    }
  }
  return items;
}

/**
 * @param {EventsPayload[]} payloads
 * @param {string} model
 * @param {string} prompt
 * @returns {(EventsResult | undefined)[]} undefined for a day Gemini returned nothing for
 */
function parseEventDays_(payloads, model, prompt) {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = payloads.map((payload, id) => ({
    id,
    date: payload.iso,
    weekday: weekdays[parseIsoDate_(payload.iso).getDay()],
    rows: payload.records.map((record) => record.fields),
  }));
  const reply = callGemini_({
    systemPrompt: prompt,
    schema: EVENTS_SCHEMA,
    input: days,
    model,
  });
  /** @type {(EventsResult | undefined)[]} */
  const results = [];
  for (const result of reply.results || []) {
    const payload = payloads[result.id];
    if (!payload || results[result.id]) continue;
    const validated = validateDayEvents_(result.events || [], payload);
    if (validated.events.length) results[result.id] = validated;
  }
  return results;
}

/**
 * Keeps what the row supports: times that are valid HH:MM with the end after the start
 * (otherwise the event is all-day), and counts that appear in the row's own text.
 *
 * @param {RawDayEvent[]} raw
 * @param {EventsPayload} payload
 * @returns {EventsResult}
 */
function validateDayEvents_(raw, payload) {
  const rowText = payload.records
    .flatMap((record) => Object.values(record.fields))
    .join(' | ')
    .toLowerCase();
  /**
   * @param {unknown} value
   * @param {string} what
   */
  const copied = (value, what) => {
    const text = cleanCell_(value);
    if (!text) return '';
    if (rowText.includes(text.toLowerCase())) return text;
    console.warn(`${payload.studio.header} ${payload.iso}: dropped ${what} "${text}", which is not in the row.`);
    return '';
  };

  /** @type {DayEvent[]} */
  const events = [];
  for (const event of raw) {
    const title = cleanCell_(event.title);
    if (!title) continue;
    let { start, end } = event;
    // A closure that begins at a time lasts until the day is over.
    if (payload.kind === 'closures' && start && !end && CLOCK_TIME.test(start)) end = END_OF_DAY;
    if (start || end) {
      const valid = start && end && CLOCK_TIME.test(start) && CLOCK_TIME.test(end);
      if (valid && payload.kind === 'classes') {
        start = afterOpening_(start ?? '');
        end = afterOpening_(end ?? '');
      }
      if (!valid || (end ?? '') <= (start ?? '')) {
        console.warn(`${payload.studio.header} ${payload.iso}: "${title}" has unusable times, made all-day; Gemini sent ${JSON.stringify(event)}`);
        start = end = undefined;
      }
    }
    events.push({
      title,
      start,
      end,
      wheels: copied(event.wheels, 'wheels'),
      handBuilding: copied(event.handBuilding, 'hand-building'),
    });
  }
  return { events };
}

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Where a closure that begins at a time ends. */
const END_OF_DAY = '23:59';

/**
 * The studio opens at 9, so an earlier class time (a typo like "3:00 AM") is the same hour
 * in the afternoon.
 *
 * @param {string} time HH:MM
 * @returns {string}
 */
function afterOpening_(time) {
  const hour = Number(time.slice(0, 2));
  return hour >= 1 && hour <= 8 ? `${hour + 12}${time.slice(2)}` : time;
}

/**
 * @param {DayEvent} event
 * @returns {string} the title with the number of people after it, e.g. "Just Try It · 18"
 */
function eventTitle_(event) {
  const space = spaceLabel_(event.wheels, event.handBuilding);
  return space?.label
    ? render_(CONTENT.titleWithCount, { title: event.title, count: space.label })
    : event.title;
}

/**
 * @param {StudioCalendar} calendar
 * @param {EventsPayload} payload
 * @param {EventsResult} result
 * @returns {string[]}
 */
function createDayEvents_(calendar, payload, result) {
  const closures = payload.kind === 'closures';
  const values = {
    dateLabel: payload.dateLabel,
    rowUrl: payload.records[0].url,
    rows: payload.records
      .map((record) => `"${Object.values(record.fields).join(' | ')}"`)
      .join('\n'),
  };
  return result.events.map((event) => {
    const space = spaceLabel_(event.wheels, event.handBuilding);
    const description = eventDescription_(calendar, payload.kind, values, space?.detail);
    const options = { description, location: payload.studio.location };
    const { style, title } = closures
      ? styledTitle_(eventTitle_(event))
      : { style: null, title: eventTitle_(event) };
    const created =
      event.start && event.end
        ? calendar.createEvent(
            title,
            dateAt_(payload.iso, event.start),
            dateAt_(payload.iso, event.end),
            options,
          )
        : calendar.createAllDayEvent(title, parseIsoDate_(payload.iso), options);
    styleEvent_(created, style);
    return created.getId();
  });
}
