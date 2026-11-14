// Runs the script in src/ against fake Apps Script services.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Apps Script evaluates each file of a project separately, in one shared global scope.
const SRC = path.join(__dirname, '..', 'src');
const FILES = fs
  .readdirSync(SRC)
  .filter((name) => name.endsWith('.js'))
  .sort()
  .map((name) => ({ name, code: fs.readFileSync(path.join(SRC, name), 'utf8') }));

const DEFAULT_TODAY = '2026-10-09T10:00:00';

/**
 * A fake Apps Script environment holding one spreadsheet, the calendars the script
 * creates, its script properties and a Gemini that splits notes on commas.
 *
 *   tabs: { 'Kiln Notes 2026': rows } — rows as getDisplayValues() returns them
 *   props: initial script properties
 *   today: local ISO date-time that new Date() and Date.now() return
 */
function createWorld({ tabs, props = {}, today = DEFAULT_TODAY } = {}) {
  const world = {
    props: {
      SOURCE_SPREADSHEET_ID: 'SHEET',
      GEMINI_API_KEY: 'test-key',
      ...props,
    },
    tabs,
    calendars: {},
    logs: [],
    requests: [],
    sleeps: [],
    triggers: [],
    gemini: {
      failCode: null,
      drop: new Set(),
      parse: fakeParse,
      parseDiscard: fakeParseDiscard,
    },
    nowMs: new Date(today).getTime(),
  };
  world.now = () => world.nowMs;

  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(world.now());
    }
    static now() {
      return world.now();
    }
  }

  const log =
    (level) =>
    (...args) =>
      world.logs.push({ level, text: args.join(' ') });

  const globals = {
    console: { log: log('log'), warn: log('warn'), error: log('error') },
    Date: FakeDate,
    PropertiesService: { getScriptProperties: () => scriptProperties(world) },
    SpreadsheetApp: { openById: () => spreadsheet(world) },
    CalendarApp: calendarApp(world),
    UrlFetchApp: { fetch: (url, request) => gemini(world, url, request) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, text) => [
        ...crypto.createHash('sha256').update(text).digest(),
      ],
      base64EncodeWebSafe: (bytes) =>
        Buffer.from(bytes.map((b) => b & 0xff)).toString('base64url'),
      sleep: (ms) => world.sleeps.push(ms),
    },
    ScriptApp: scriptApp(world),
  };

  world.context = vm.createContext(globals);
  for (const file of FILES) {
    vm.runInContext(file.code, world.context, { filename: file.name });
  }
  world.fn = world.context; // Top-level functions become context properties.
  world.eval = (expression) => vm.runInContext(expression, world.context);

  world.events = (calendarName) =>
    Object.values(world.calendars[calendarName]?.events || {});
  world.allEvents = () =>
    Object.values(world.calendars).flatMap((c) => Object.values(c.events));
  world.state = () =>
    Object.keys(world.props).filter((name) => name.startsWith('cell:'));
  world.summary = () =>
    world.logs.filter((l) => /^(Sync|Preview) of /.test(l.text)).at(-1)?.text;
  world.setCell = (tab, row, col, text) => {
    world.tabs[tab][row][col] = text;
  };
  return world;
}

function scriptProperties(world) {
  return {
    getProperty: (name) => world.props[name] ?? null,
    setProperty: (name, value) => {
      world.props[name] = String(value);
    },
    deleteProperty: (name) => {
      delete world.props[name];
    },
    getProperties: () => ({ ...world.props }),
  };
}

function spreadsheet(world) {
  return {
    getId: () => 'SHEET',
    getSheets: () =>
      Object.entries(world.tabs).map(([name, rows], index) => ({
        getName: () => name,
        getSheetId: () => 1000 + index,
        getDataRange: () => ({ getDisplayValues: () => rows }),
      })),
  };
}

let nextEventId = 1;

function calendarApp(world) {
  const createCalendar = (name) => {
    const events = {};
    const calendar = {
      name,
      events,
      description: '',
      getId: () => `${name.replace(/\W+/g, '')}@group.calendar.google.com`,
      getName: () => name,
      getDescription: () => calendar.description,
      setDescription: (text) => {
        calendar.description = text;
      },
      createAllDayEvent: (title, date, options) =>
        addEvent(events, { title, date, allDay: true, ...options }),
      createEvent: (title, start, end, options) =>
        addEvent(events, { title, start, end, allDay: false, ...options }),
      getEventById: (id) =>
        events[id] ? { deleteEvent: () => delete events[id] } : null,
    };
    world.calendars[name] = calendar;
    return calendar;
  };
  return {
    getCalendarsByName: (name) =>
      world.calendars[name] ? [world.calendars[name]] : [],
    createCalendar,
  };
}

function addEvent(events, fields) {
  const id = `event-${nextEventId++}`;
  const record = { id, color: null, ...fields };
  events[id] = record;
  return {
    getId: () => id,
    getTitle: () => record.title,
    isAllDayEvent: () => record.allDay,
    setColor: (color) => {
      // Calendar rejects anything but the 11 legacy color IDs, as strings.
      if (!/^([1-9]|1[01])$/.test(color)) {
        throw new Error(`Invalid argument: ${color}`);
      }
      record.color = color;
    },
  };
}

/** Splits a note into activities on commas and periods; "by 4pm" becomes a timed item. */
function fakeParse(note) {
  const match = note.note.match(/by ~?(\d{1,2})\s*(am|pm)/i);
  const timed = [];
  if (match) {
    const hour = (Number(match[1]) % 12) + (/pm/i.test(match[2]) ? 12 : 0);
    timed.push({
      title: 'Unload',
      date: note.date,
      time: `${String(hour).padStart(2, '0')}:00`,
    });
  }
  const activities = note.note
    .replace(/\(.*?\)/g, '')
    .split(/[,.]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const events = [
    ...activities.map((title) => ({ title, date: note.date })),
    ...timed,
  ];
  return { id: note.id, events };
}

/** Reads "Label: | 9/14/2026 | Oct 1 → Dec 1" lines into groups of dates, as written. */
function fakeParseDiscard({ text }) {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const groups = [];
  for (const line of text.split('\n')) {
    const [label, ...rest] = line.split(':');
    if (!rest.length) continue;
    const dates = [];
    for (const token of rest.join(':').split(/[|→,]/)) {
      const full = token.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      const named = token.match(/([A-Za-z]{3}) (\d{1,2})/);
      if (full) dates.push({ month: +full[1], day: +full[2], year: +full[3] });
      else if (named && months.includes(named[1].toLowerCase())) {
        dates.push({ month: months.indexOf(named[1].toLowerCase()) + 1, day: +named[2] });
      }
    }
    if (dates.length) groups.push({ workType: label.trim(), dates });
  }
  return { groups };
}

function gemini(world, url, request) {
  const payload = JSON.parse(request.payload);
  const input = JSON.parse(payload.contents[0].parts[0].text);
  const isDiscard = /discard schedule/i.test(payload.systemInstruction.parts[0].text);
  const notes = isDiscard ? undefined : input;
  world.requests.push({
    url,
    notes,
    discard: isDiscard ? input : undefined,
    generationConfig: payload.generationConfig,
  });
  if (world.gemini.failCode) {
    return response(world.gemini.failCode, { error: { message: 'failure' } });
  }
  if (isDiscard) {
    const reply = world.gemini.parseDiscard(input);
    return response(200, {
      candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }],
    });
  }
  const results = notes
    .filter((note) => !world.gemini.drop.has(note.note))
    .map((note) => world.gemini.parse(note));
  return response(200, {
    candidates: [{ content: { parts: [{ text: JSON.stringify({ results }) }] } }],
  });
}

function response(code, body) {
  const text = JSON.stringify(body);
  return { getResponseCode: () => code, getContentText: () => text };
}

function scriptApp(world) {
  const builder = (handler) => ({
    timeBased: () => ({
      everyMinutes: (minutes) => ({
        create: () => world.triggers.push({ handler, every: `${minutes}m` }),
      }),
      everyHours: (hours) => ({
        create: () => world.triggers.push({ handler, every: `${hours}h` }),
      }),
    }),
  });
  return {
    getProjectTriggers: () =>
      world.triggers.map((trigger) => ({
        ...trigger,
        getHandlerFunction: () => trigger.handler,
        ref: trigger,
      })),
    deleteTrigger: (trigger) => {
      world.triggers.splice(world.triggers.indexOf(trigger.ref), 1);
    },
    newTrigger: builder,
    getOAuthToken: () => 'token',
  };
}

module.exports = { createWorld };
