const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');
const { EVENTS_TAB, eventsRows, eventsRow, eventsTabs } = require('./fixture');

const DT = 'Higher Fire · Kiln Notes & Events';
const CLASSES = 'Higher Fire · Classes';
const URL_BASE = 'https://docs.google.com/spreadsheets/d/SHEET/edit?gid=1001#gid=1001';

const newWorld = (options = {}) => createWorld({ tabs: eventsTabs(), ...options });
const plain = (value) => JSON.parse(JSON.stringify(value));
const hhmm = (date) => date.toTimeString().slice(0, 5);

/** "2026-10-10 10:00-13:00 18 W · Just Try It", the way the calendar shows an event. */
const describe = (world, event) => {
  const day = world.fn.isoDate_(event.allDay ? event.date : event.start);
  const when = event.allDay ? 'all day' : `${hhmm(event.start)}-${hhmm(event.end)}`;
  return `${day} ${when} ${event.title}`;
};
const classes = (world) => world.events(CLASSES).map((e) => describe(world, e)).sort();
// Closure and workshop descriptions open with "Original (", kiln notes with "Original note (".
const closures = (world) =>
  world
    .events(DT)
    .filter((e) => e.description.includes('Original ('))
    .map((e) => describe(world, e))
    .sort();
const warnings = (world) => world.logs.filter((l) => l.level === 'warn').map((l) => l.text);

test('class sessions go to the classes calendar with the number of people in front', () => {
  const world = newWorld();
  world.fn.sync();

  assert.deepEqual(classes(world), [
    '2026-10-08 19:00-22:00 18 · Just Try It',
    '2026-10-09 14:00-16:00 20 · Wheel Package',
    '2026-10-09 18:00-21:00 Hand-building Sampler',
    '2026-10-10 10:00-13:00 18 · Just Try It',
    '2026-10-10 15:00-17:00 6 · Take a Spin',
    '2026-10-13 10:00-12:00 9 · Mug & Bowl Pkg',
    '2026-10-14 19:00-22:00 18 · Just Try It',
  ]);
});

test('a class time before the studio opens is read as the afternoon', () => {
  const world = newWorld();
  world.fn.sync();

  const spin = world.events(CLASSES).find((e) => e.title.endsWith('Take a Spin'));
  assert.equal(hhmm(spin.start), '15:00');
  assert.equal(hhmm(spin.end), '17:00');
});

test('classes are synced 60 days ahead, so a class beyond that is left out', () => {
  const world = newWorld();
  world.fn.sync();
  assert.ok(!classes(world).some((c) => c.startsWith('2026-12-12')));
});

test('closures go to the main calendar, styled like the kiln closures', () => {
  const world = newWorld();
  world.fn.sync();

  assert.deepEqual(closures(world), [
    '2026-10-12 all day 🔴 STUDIO CLOSED FOR THE HOLIDAY',
    '2026-10-14 all day 🔴 5:30 Closure - Studio closes early for an offsite',
    '2026-11-07 10:00-13:00 Extruder 1 with Sam Rivera',
    '2026-12-25 all day 🔴 STUDIO CLOSED FOR CHRISTMAS',
  ]);
  const closure = world.events(DT).find((e) => e.title.includes('FOR THE HOLIDAY'));
  assert.equal(closure.color, '4', "the Closure stage's color");
});

test('closures and workshops reach 180 days ahead, past the classes window', () => {
  const world = newWorld();
  world.fn.sync();
  assert.ok(closures(world).some((c) => c.startsWith('2026-12-25')));
  assert.ok(!world.events(DT).some((e) => e.title.includes('Just Try It')), 'no classes on the main calendar');
});

test("a row with no date belongs to the date above, wherever it sits in the sheet", () => {
  const world = newWorld();
  world.fn.sync();

  const sampler = world.events(CLASSES).find((e) => e.title.endsWith('Hand-building Sampler'));
  assert.equal(world.fn.isoDate_(sampler.start), '2026-10-09');
  const early = world.events(DT).find((e) => e.title.includes('5:30 Closure'));
  assert.equal(world.fn.isoDate_(early.date), '2026-10-14');
});

test('a side-table workshop is a timed event on the date in its own entry', () => {
  const world = newWorld();
  world.fn.sync();

  const workshop = world.events(DT).find((e) => e.title.includes('Extruder 1'));
  assert.equal(workshop.allDay, false);
  assert.equal(world.fn.isoDate_(workshop.start), '2026-11-07');
  assert.equal(workshop.location, '499 S Market St, San Jose, CA 95113');
  assert.ok(workshop.description.includes(`${URL_BASE}&range=N13:R13`));
});

test("a class named like a kiln stage stays plain on the classes calendar", () => {
  const world = newWorld();
  world.tabs[EVENTS_TAB][3] = eventsRow({ date: 'Thu, Oct 8', start: '7:00 PM', end: '10:00 PM', event: 'Unloading Basics', wheels: '4' });

  world.fn.sync();

  const event = world.events(CLASSES).find((e) => e.title.includes('Unloading Basics'));
  assert.equal(event.title, '4 · Unloading Basics', 'no stage emoji');
  assert.equal(event.color, null, 'no stage color');
});

test('a class description states the space in words and links its row', () => {
  const world = newWorld();
  world.fn.sync();

  const event = world.events(CLASSES).find((e) => e.title === '18 · Just Try It');
  const sections = event.description.split('\n\n');
  assert.equal(sections[0], 'Space taken: 18 wheels');
  assert.equal(sections[1], `Original row (Thu, Oct 8):\n${URL_BASE}&range=A4:H4`);
  assert.equal(sections[2], '─'.repeat(19));
  assert.match(sections.at(-1), /Check the original row before relying on an event\.$/);

  const mix = world.events(CLASSES).find((e) => e.title.includes('Mug & Bowl'));
  assert.equal(mix.description.split('\n\n')[0], 'Space taken: 9 wheels; 9 seats + tools');
});

test('a closure description quotes the original text', () => {
  const world = newWorld();
  world.fn.sync();

  const event = world.events(DT).find((e) => e.title.includes('FOR THE HOLIDAY'));
  assert.equal(
    event.description.split('\n\n')[0],
    `Original (Mon, Oct 12):\n"STUDIO CLOSED FOR THE HOLIDAY"\n${URL_BASE}&range=A9:H9`,
  );
  assert.match(event.description, /Check the original text before relying on an event\.$/);
  assert.equal(event.location, '499 S Market St, San Jose, CA 95113');
});

test('each source sends its days in one request, and unchanged days are not sent again', () => {
  const world = newWorld();
  world.fn.sync();

  const classRequests = world.requests.filter((r) => r.kind === 'classes');
  const closureRequests = world.requests.filter((r) => r.kind === 'closures');
  assert.equal(classRequests.length, 1);
  assert.equal(classRequests[0].days.length, 5);
  assert.equal(closureRequests.length, 1);
  assert.equal(closureRequests[0].days.length, 4);
  assert.deepEqual(classRequests[0].days[0].rows[0], {
    Start: '7:00 PM',
    End: '10:00 PM',
    Event: 'Just Try It',
    '# of Wheels': '18',
  });

  world.fn.sync();
  assert.equal(world.requests.filter((r) => r.kind === 'classes' || r.kind === 'closures').length, 2);
});

test("editing a day's rows replaces only that day's events", () => {
  const world = newWorld();
  world.fn.sync();
  world.tabs[EVENTS_TAB][3] = eventsRow({ date: 'Thu, Oct 8', start: '8:00 PM', end: '10:00 PM', event: 'Just Try It', wheels: '12' });

  world.fn.sync();

  assert.ok(classes(world).includes('2026-10-08 20:00-22:00 12 · Just Try It'));
  assert.ok(!classes(world).some((c) => c.startsWith('2026-10-08 19:00')));
  assert.equal(classes(world).length, 7);
  assert.equal(world.requests.filter((r) => r.kind === 'classes').length, 2);
  assert.equal(world.requests.filter((r) => r.kind === 'classes')[1].days.length, 1);
});

test('a wheel count that is not in the row is dropped', () => {
  const world = newWorld();
  const real = world.gemini.parseDays;
  world.gemini.parseDays = (kind, days) => {
    const reply = real(kind, days);
    if (kind === 'classes') reply.results[0].events[0].wheels = '99';
    return reply;
  };

  world.fn.sync();

  assert.ok(classes(world).includes('2026-10-08 19:00-22:00 Just Try It'), 'no label rather than a wrong one');
  assert.ok(warnings(world).some((w) => /dropped wheels "99", which is not in the row/.test(w)));
});

test('times that cannot be used make the event all-day instead of losing it', () => {
  const world = newWorld();
  const real = world.gemini.parseDays;
  world.gemini.parseDays = (kind, days) => {
    const reply = real(kind, days);
    if (kind === 'classes') {
      reply.results[0].events[0].start = 'noon';
      reply.results[1].events[0].end = '13:00'; // before its 14:00 start
    }
    return reply;
  };

  world.fn.sync();

  assert.ok(classes(world).includes('2026-10-08 all day 18 · Just Try It'));
  assert.ok(classes(world).includes('2026-10-09 all day 20 · Wheel Package'));
  assert.equal(warnings(world).filter((w) => /unusable times/.test(w)).length, 2);
});

test("a day Gemini returns nothing for is retried, not recorded as empty", () => {
  const world = newWorld();
  const real = world.gemini.parseDays;
  let calls = 0;
  world.gemini.parseDays = (kind, days) => {
    const reply = real(kind, days);
    if (kind === 'classes' && calls++ === 0) reply.results[0].events = [];
    return reply;
  };

  world.fn.sync();
  assert.equal(classes(world).length, 6, 'the Oct 8 class is missing');
  assert.match(world.summary(), /1 failed/);

  world.fn.sync();
  assert.equal(classes(world).length, 7);
});

test('a missing events tab warns and removes its events, without stopping the kiln notes', () => {
  const world = newWorld();
  world.fn.sync();
  delete world.tabs[EVENTS_TAB];

  world.fn.sync();

  assert.deepEqual(classes(world), []);
  assert.deepEqual(closures(world), []);
  assert.ok(warnings(world).some((w) => /No events tab for Downtown 2026/.test(w)));
  assert.ok(world.events(DT).some((e) => e.title.includes('Bisque')), 'kiln events kept');
});

test('a studio without an events tab setting is left alone', () => {
  const world = newWorld();
  world.fn.sync();
  assert.deepEqual(world.events('Higher Fire · JTown').filter((e) => e.description.includes('Original (')), []);
  assert.equal(world.calendars['Higher Fire · JTown Classes'], undefined);
});

test('reset removes events from every source, including classes and closures', () => {
  const world = newWorld();
  world.fn.sync();

  world.fn.reset();

  assert.equal(world.allEvents().length, 0);
  assert.deepEqual(
    Object.keys(world.props).filter((k) => /^(cell|discard|classes|closures):/.test(k)),
    [],
  );
});

// --- reading the tab ---

const window = (world, today, days) => {
  const Date = world.eval('Date');
  const t = new Date(...today);
  return {
    today: t,
    windowStart: new Date(t.getFullYear(), t.getMonth(), t.getDate() - 14),
    windowEnd: new Date(t.getFullYear(), t.getMonth(), t.getDate() + days),
  };
};
const records = (world, rows, days = 60) =>
  plain(world.fn.eventsRecords_(rows, 2026, window(world, [2026, 9, 9], days), URL_BASE, 'Downtown'));

test('records pair each non-empty cell with its column header and skip empty rows', () => {
  const world = newWorld();
  const found = records(world, eventsRows());
  const first = found[0];
  assert.equal(first.kind, 'schedule');
  assert.equal(first.dateLabel, 'Thu, Oct 8');
  assert.equal(first.rowNumber, 4);
  assert.deepEqual(first.fields, { Start: '7:00 PM', End: '10:00 PM', Event: 'Just Try It', '# of Wheels': '18' });
  assert.ok(!found.some((r) => Object.keys(r.fields).length === 0));
});

test('a row without an event name is an announcement; text in the side columns is a side entry', () => {
  const world = newWorld();
  const found = records(world, eventsRows(), 180);
  assert.deepEqual(
    found.map((r) => r.kind).filter((k) => k !== 'schedule'),
    ['announcement', 'announcement', 'side', 'announcement'],
  );
  const side = found.find((r) => r.kind === 'side');
  assert.deepEqual(side.fields, {
    'Side table': 'Sat, Nov 7 | 10am-1pm | Extruder 1 with Sam Rivera | Hand-building',
  });
});

test('side-table text without a date is skipped with a warning', () => {
  const world = newWorld();
  const rows = eventsRows();
  rows.push(eventsRow({ side: ['see the front desk'] }));
  const found = records(world, rows, 180);
  assert.ok(!found.some((r) => r.kind === 'side' && /front desk/.test(r.fields['Side table'])));
  assert.ok(warnings(world).some((w) => /skipped side-table text without a date in row 16/.test(w)));
});

test('rows under a label in the Date column do not inherit the date above it', () => {
  const world = newWorld();
  const rows = [
    ['Date', 'Start', 'End', 'Event'],
    ['Fri, Oct 9', '2:00 PM', '4:00 PM', 'Wheel Package'],
    ['NEXT SEASON', '', '', ''],
    ['', '6:00 PM', '9:00 PM', 'Hand-building Sampler'],
  ];
  const found = records(world, rows);
  assert.deepEqual(found.map((r) => r.fields.Event), ['Wheel Package']);
});

test('a tab without the expected headers warns and yields nothing', () => {
  const world = newWorld();
  assert.deepEqual(records(world, [['x', 'y']]), []);
  assert.match(warnings(world).at(-1), /no header row with "Date"/);

  assert.deepEqual(records(world, [['Date', 'Start', 'End']]), []);
  assert.match(warnings(world).at(-1), /no "Event" column/);
});

test("the table's columns can move, since cells are read by header", () => {
  const world = newWorld();
  const rows = [
    ['Date', 'Event', 'Start', 'End'],
    ['Fri, Oct 9', 'Wheel Package', '2:00 PM', '4:00 PM'],
  ];
  const [record] = records(world, rows);
  assert.equal(record.kind, 'schedule');
  assert.deepEqual(record.fields, { Event: 'Wheel Package', Start: '2:00 PM', End: '4:00 PM' });
});

test('two tabs matching the studio fail the run before anything is written', () => {
  const world = newWorld();
  world.tabs['DT Events 2026 backup'] = world.tabs[EVENTS_TAB];

  assert.throws(() => world.fn.sync(), /Several tabs match Downtown's events 2026/);
  assert.equal(world.allEvents().length, 0);
});

test('a tab that only starts with something else, like a copy, is not the events tab', () => {
  const world = newWorld();
  world.tabs['Copy of DT Events 2026'] = world.tabs[EVENTS_TAB];

  world.fn.sync();

  assert.equal(classes(world).length, 7);
});

test('the kiln notes keep syncing alongside the events tab', () => {
  const world = newWorld();
  world.fn.sync();
  assert.ok(world.events(DT).some((e) => e.title.includes('Bisque')));
  assert.equal(world.state().length, 9);
});

test('empty strings, which the schema requires for a missing value, read as none', () => {
  const world = newWorld();
  const real = world.gemini.parseDays;
  world.gemini.parseDays = (kind, days) => {
    const reply = real(kind, days);
    for (const result of reply.results) {
      for (const event of result.events) {
        for (const field of ['start', 'end', 'wheels', 'handBuilding']) {
          if (event[field] === undefined) event[field] = '';
        }
      }
    }
    return reply;
  };

  world.fn.sync();

  assert.equal(classes(world).length, 7);
  assert.ok(closures(world).includes('2026-10-12 all day 🔴 STUDIO CLOSED FOR THE HOLIDAY'));
  assert.deepEqual(warnings(world).filter((w) => /dropped|unusable/.test(w)), []);
});

test('resetSource removes one source\'s events and leaves the others', () => {
  const world = newWorld();
  world.fn.sync();
  const kiln = world.events(DT).filter((e) => e.description.includes('Original note (')).length;

  world.fn.resetSource('classes');

  assert.deepEqual(classes(world), []);
  assert.equal(closures(world).length, 4, 'closures untouched');
  assert.equal(world.events(DT).filter((e) => e.description.includes('Original note (')).length, kiln);
  assert.deepEqual(Object.keys(world.props).filter((k) => k.startsWith('classes:')), []);
  assert.ok(Object.keys(world.props).some((k) => k.startsWith('closures:')));

  world.fn.sync();
  assert.equal(classes(world).length, 7, 'rebuilt by the next sync');
});

test('resetSource names the sources when given a wrong one', () => {
  const world = newWorld();
  assert.throws(() => world.fn.resetSource('nope'), /No source named "nope"; the sources are kiln, discard, closures, classes/);
});

test('purgeClasses clears the classes calendar, orphans included, and nothing else', () => {
  const world = newWorld();
  world.fn.sync();
  const closureCount = closures(world).length;
  // Two runs that overlap leave copies no state entry points to.
  world.calendars[CLASSES].createAllDayEvent('orphan copy', new Date(2026, 10, 14), {});

  world.fn.purgeClasses();

  assert.equal(world.events(CLASSES).length, 0);
  assert.equal(closures(world).length, closureCount, 'closures untouched');
  assert.ok(world.events(DT).some((e) => e.title.includes('Bisque')), 'kiln events untouched');
  assert.deepEqual(Object.keys(world.props).filter((k) => k.startsWith('classes:')), []);

  world.fn.sync();
  assert.equal(classes(world).length, 7, 'rebuilt by the next sync');
});

const OLD_MAIN = 'Higher Fire · Downtown';
const OLD_CLASSES = 'Higher Fire · Downtown Classes';

/** A world configured with the calendar names the script used before they were renamed. */
function worldWithOldNames() {
  const world = newWorld();
  world.eval(`CONFIG.STUDIOS[0].calendarName = ${JSON.stringify(OLD_MAIN)}; CONFIG.STUDIOS[0].classesCalendarName = ${JSON.stringify(OLD_CLASSES)};`);
  return world;
}
const useNewNames = (world) =>
  world.eval(`CONFIG.STUDIOS[0].calendarName = ${JSON.stringify(DT)}; CONFIG.STUDIOS[0].classesCalendarName = ${JSON.stringify(CLASSES)};`);

test('renameCalendar renames the real calendar and the names stored for its events', () => {
  const world = worldWithOldNames();
  world.fn.sync();
  const before = world.events(OLD_MAIN).length;

  world.fn.renameCalendar(OLD_MAIN, DT);

  assert.equal(world.calendars[OLD_MAIN], undefined);
  assert.equal(world.events(DT).length, before, 'the events came with it');
  const stored = Object.entries(world.props)
    .filter(([k]) => /^(cell|discard|closures):/.test(k))
    .map(([, v]) => JSON.parse(v).calendarName);
  assert.ok(stored.length > 0);
  assert.ok(stored.every((name) => name !== OLD_MAIN), 'no stored item still names the old calendar');
  assert.ok(stored.includes(DT));
});

test('after a rename and the new config, a sync recreates nothing and a reset still finds the events', () => {
  const world = worldWithOldNames();
  world.fn.sync();
  world.fn.renameCalendar(OLD_MAIN, DT);
  world.fn.renameCalendar(OLD_CLASSES, CLASSES);
  useNewNames(world);
  const eventCount = world.allEvents().length;
  const requests = world.requests.length;

  world.fn.sync();

  assert.equal(world.allEvents().length, eventCount);
  assert.equal(world.requests.length, requests, 'nothing was parsed again');
  assert.equal(world.calendars[OLD_MAIN], undefined, 'no calendar under the old main name');
  assert.equal(world.calendars[OLD_CLASSES], undefined, 'no calendar under the old classes name');

  world.fn.reset();
  assert.equal(world.allEvents().length, 0);
});

test('renameCalendar can be run again after a failure, and refuses to merge calendars', () => {
  const world = worldWithOldNames();
  world.fn.sync();
  world.fn.renameCalendar(OLD_MAIN, DT);

  world.fn.renameCalendar(OLD_MAIN, DT); // already renamed: just rewrites stored names

  assert.throws(() => world.fn.renameCalendar('No such calendar', 'Another'), /No calendar named/);
  world.calendars[OLD_MAIN] = { name: OLD_MAIN, events: {}, getName: () => OLD_MAIN };
  assert.throws(() => world.fn.renameCalendar(OLD_MAIN, DT), /Both .* exist/);
});

test('pauseTrigger stops the schedule and installTrigger resumes it', () => {
  const world = newWorld();
  world.fn.installTrigger();
  assert.equal(world.triggers.length, 1);

  world.fn.pauseTrigger();
  assert.equal(world.triggers.length, 0);

  world.fn.installTrigger();
  assert.equal(world.triggers.length, 1);
});
