const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');
const { allTabs, DISCARD_TAB_DT, DISCARD_TAB_JT } = require('./fixture');

const DT = 'Higher Fire · Downtown';
const JT = 'Higher Fire · JTown';
const DAY = 24 * 60 * 60 * 1000;

const newWorld = (options = {}) => createWorld({ tabs: allTabs(), ...options });
const plain = (value) => JSON.parse(JSON.stringify(value));
const day = (world, y, m, d) => new (world.eval('Date'))(y, m - 1, d);
// Array.from copies out of the sandbox, whose arrays don't compare equal to ours.
const isoList = (world, dates) => Array.from(dates, (d) => world.fn.isoDate_(d));
const discardEvents = (world, calendar) =>
  world
    .events(calendar)
    .filter((e) => e.title.startsWith('Discard day'))
    .map((e) => `${world.fn.isoDate_(e.date)} ${e.title}`)
    .sort();
const warnings = (world) =>
  world.logs.filter((l) => l.level === 'warn').map((l) => l.text);

test('discard dates written with years are used as written', () => {
  const world = newWorld();
  const dates = [
    { month: 9, day: 14, year: 2026 },
    { month: 1, day: 12, year: 2027 },
  ];
  const resolved = world.fn.resolveDiscardDates_(dates, day(world, 2026, 11, 13), 'DT');
  assert.deepEqual(isoList(world, resolved), ['2026-09-14', '2027-01-12']);
});

test('a list without years starts at the date nearest today and keeps going forward', () => {
  const world = newWorld();
  const list = [[10, 1], [12, 1], [2, 1], [4, 1], [6, 1], [8, 1], [10, 1], [12, 1]].map(
    ([month, d]) => ({ month, day: d }),
  );
  const resolved = world.fn.resolveDiscardDates_(list, day(world, 2026, 11, 13), 'JT');
  assert.deepEqual(isoList(world, resolved), [
    '2026-10-01', '2026-12-01', '2027-02-01', '2027-04-01',
    '2027-06-01', '2027-08-01', '2027-10-01', '2027-12-01',
  ]);
});

test('the first date without a year is the nearest one on either side of today', () => {
  const world = newWorld();
  const first = (month, d, today) =>
    world.fn.isoDate_(
      world.fn.resolveDiscardDates_([{ month, day: d }], today, 'JT')[0],
    );
  assert.equal(first(1, 15, day(world, 2026, 12, 20)), '2027-01-15');
  assert.equal(first(12, 1, day(world, 2027, 1, 5)), '2026-12-01');
  assert.equal(first(10, 1, day(world, 2026, 9, 20)), '2026-10-01');
  assert.equal(first(10, 1, day(world, 2026, 11, 13)), '2026-10-01');
});

test('a date without a year follows the date before it, even one with a year', () => {
  const world = newWorld();
  const today = day(world, 2026, 10, 9);
  const resolve = (dates) =>
    isoList(world, world.fn.resolveDiscardDates_(dates, today, 'DT'));
  assert.deepEqual(resolve([{ month: 9, day: 14, year: 2026 }, { month: 11, day: 13 }]), [
    '2026-09-14',
    '2026-11-13',
  ]);
  assert.deepEqual(resolve([{ month: 11, day: 13, year: 2026 }, { month: 1, day: 12 }]), [
    '2026-11-13',
    '2027-01-12',
  ]);
});

test('invalid or incomplete dates are skipped with a warning', () => {
  const world = newWorld();
  const resolved = world.fn.resolveDiscardDates_(
    [{ month: 2, day: 30 }, { month: 6 }, { month: 6, day: 1, year: 2027 }],
    day(world, 2026, 10, 9),
    'DT',
  );
  assert.deepEqual(isoList(world, resolved), ['2027-06-01']);
  assert.equal(warnings(world).length, 2);
  assert.match(warnings(world)[0], /DT: skipped an invalid discard date 2\/30/);
});

test('types of work discarded on the same day share one event, past dates are skipped', () => {
  const world = newWorld();
  const reply = {
    groups: [
      { workType: 'Bisque', dates: [{ month: 9, day: 14, year: 2026 }, { month: 11, day: 13, year: 2026 }] },
      { workType: 'Glazed Fired Work', dates: [{ month: 11, day: 13, year: 2026 }, { month: 12, day: 1, year: 2026 }] },
    ],
  };
  const result = world.fn.discardEvents_(reply, day(world, 2026, 10, 9), 'DT');
  assert.deepEqual(plain(result.events), [
    { date: '2026-11-13', title: 'Discard day: Bisque, Glazed Fired Work' },
    { date: '2026-12-01', title: 'Discard day: Glazed Fired Work' },
  ]);
});

test('a schedule with nothing upcoming warns instead of failing', () => {
  const world = newWorld();
  const today = day(world, 2026, 10, 9);
  const past = { groups: [{ workType: 'Bisque', dates: [{ month: 1, day: 5, year: 2026 }] }] };
  assert.deepEqual(plain(world.fn.discardEvents_(past, today, 'DT').events), []);
  assert.match(warnings(world).at(-1), /DT: every discard date is in the past/);

  assert.deepEqual(plain(world.fn.discardEvents_({ groups: [] }, today, 'DT').events), []);
  assert.match(warnings(world).at(-1), /DT: no discard dates found/);
});

test('the first sync creates each studio its discard events, from its own tab', () => {
  const world = newWorld();
  world.fn.sync();

  assert.deepEqual(discardEvents(world, DT), [
    '2026-11-13 Discard day: Bisque, Glazed Fired Work',
    '2027-01-12 Discard day: Bisque, Glazed Fired Work',
  ]);
  assert.deepEqual(discardEvents(world, JT).map((e) => e.slice(0, 10)), [
    '2026-12-01', '2027-02-01', '2027-04-01', '2027-06-01',
    '2027-08-01', '2027-10-01', '2027-12-01',
  ]);
  assert.equal(world.requests.filter((r) => r.discard).length, 2, 'one request per tab');
  assert.equal(world.state().length, 9, 'kiln notes unaffected');
  assert.equal(
    Object.keys(world.props).filter((k) => k.startsWith('discard:')).length,
    2,
  );
});

test('a discard event is plain: all day, studio location, no color, linked to its tab', () => {
  const world = newWorld();
  world.fn.sync();

  const event = world.events(DT).find((e) => e.title.startsWith('Discard day'));
  assert.equal(event.allDay, true);
  assert.equal(event.color, null);
  assert.equal(event.location, '499 S Market St, San Jose, CA 95113');
  const sections = event.description.split('\n\n');
  assert.equal(
    sections[0],
    'Original schedule (Pottery Discard Schedule DT):\nhttps://docs.google.com/spreadsheets/d/SHEET/edit?gid=1001#gid=1001',
  );
  assert.equal(sections[1], '─'.repeat(19));
  assert.match(sections.at(-1), /Check the original schedule before relying on an event\.$/);
});

test('the tab name is trimmed in the description', () => {
  const world = newWorld();
  world.fn.sync();
  const event = world.events(JT).find((e) => e.title.startsWith('Discard day'));
  assert.match(event.description, /^Original schedule \(Pottery Discard Schedule JT\):/);
});

test('an unchanged schedule is not read again, however long it stays', () => {
  const world = newWorld();
  world.fn.sync();
  const before = world.allEvents().length;

  world.nowMs += 40 * DAY;
  world.fn.sync();
  world.fn.sync();

  assert.equal(world.requests.filter((r) => r.discard).length, 2);
  assert.equal(world.events(DT).filter((e) => e.title.startsWith('Discard day')).length, 2);
  assert.ok(world.allEvents().length >= before - 12, 'only kiln events may age out');
});

test("editing a studio's schedule replaces only that studio's discard events", () => {
  const world = newWorld();
  world.fn.sync();
  const jtBefore = discardEvents(world, JT);
  world.tabs[DISCARD_TAB_DT].push(['Bisque:  ', '3/15/2027']);

  world.fn.sync();

  assert.equal(world.requests.filter((r) => r.discard).length, 3);
  assert.deepEqual(discardEvents(world, JT), jtBefore);
  assert.ok(discardEvents(world, DT).some((e) => e.startsWith('2027-03-15')));
  assert.equal(
    world.events(DT).filter((e) => e.title.startsWith('Discard day')).length,
    3,
    'the old events were removed, not duplicated',
  );
});

test("a studio's discard events go away when its tab does, without stopping the rest", () => {
  const world = newWorld();
  world.fn.sync();
  delete world.tabs[DISCARD_TAB_JT];

  world.fn.sync();

  assert.deepEqual(discardEvents(world, JT), []);
  assert.equal(discardEvents(world, DT).length, 2);
  assert.equal(world.events(DT).length, 7 + 2, 'kiln events kept');
  assert.ok(warnings(world).some((w) => /No discard schedule tab for JTown/.test(w)));
});

test('two tabs matching one studio fail the run before anything is written', () => {
  const world = newWorld();
  world.tabs['Copy of Pottery Discard Schedule DT'] = world.tabs[DISCARD_TAB_DT];

  assert.throws(() => world.fn.sync(), /Several tabs match Downtown's discard schedule/);
  assert.equal(world.allEvents().length, 0);
});

test('a schedule with nothing upcoming is remembered, so it is not read every run', () => {
  const world = newWorld();
  world.nowMs = new Date('2027-06-01T10:00:00').getTime();
  world.tabs['Kiln Notes 2027'] = [['Date', '', 'Downtown', 'JTown']];
  world.tabs[DISCARD_TAB_DT] = [['Bisque:  ', '9/14/2026']];

  world.fn.sync();
  world.fn.sync();

  assert.deepEqual(discardEvents(world, DT), []);
  const requests = world.requests.filter((r) => r.discard && /9\/14\/2026/.test(r.discard.text));
  assert.equal(requests.length, 1);
  assert.ok(warnings(world).some((w) => /Downtown: every discard date is in the past/.test(w)));
});

test('a failing discard parse leaves the kiln events in place and is retried', () => {
  const world = newWorld();
  const working = world.gemini.parseDiscard;
  world.gemini.parseDiscard = () => {
    throw new (world.eval('Error'))('no discard for you');
  };

  world.fn.sync();

  assert.equal(world.events(DT).length, 7, 'kiln events created');
  assert.deepEqual(discardEvents(world, DT), []);
  assert.match(world.summary(), /2 failed/);
  assert.ok(
    world.logs.some((l) => /Skipping 2 discard item\(s\) until the next run: no discard for you/.test(l.text)),
  );

  world.gemini.parseDiscard = working;
  world.fn.sync();
  assert.equal(discardEvents(world, DT).length, 2);
});

test('preview shows what a discard schedule would become and writes nothing', () => {
  const world = newWorld();
  world.fn.preview();

  assert.deepEqual(Object.keys(world.calendars), []);
  assert.ok(
    world.logs.some((l) =>
      /Would add Downtown discard schedule\n {2}→ 2026-11-13 Discard day: Bisque, Glazed Fired Work · 2027-01-12/.test(l.text),
    ),
  );
});

test("the tab text sent to Gemini has one line per row, cells joined with ' | '", () => {
  const world = newWorld();
  world.fn.sync();
  const dt = world.requests.find((r) => r.discard && /DT Studio/.test(r.discard.text));
  assert.ok(dt.discard.text.includes('Bisque: | 9/14/2026 | 11/13/2026 | 1/12/2027'));
  assert.ok(!dt.discard.text.includes('\n\n'), 'no blank lines');
  const jt = world.requests.find((r) => r.discard && /JT Studio/.test(r.discard.text));
  assert.ok(jt.discard.text.includes('Bisque: | Oct 1 → Dec 1→ Feb 1'));
});

test('a tab deleted long after it was synced still has its events removed', () => {
  const world = newWorld();
  world.fn.sync();
  world.nowMs += 40 * DAY;
  delete world.tabs[DISCARD_TAB_JT];

  world.fn.sync();

  assert.deepEqual(discardEvents(world, JT), []);
});
