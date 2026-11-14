const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');
const { TAB, kilnRows } = require('./fixture');

const DT = 'Higher Fire · Downtown';
const JT = 'Higher Fire · JTown';
const DAY = 24 * 60 * 60 * 1000;

const newWorld = (options = {}) =>
  createWorld({ tabs: { [TAB]: kilnRows() }, ...options });
const titles = (events) => events.map((e) => e.title).sort();
const byTitle = (world, calendar, title) =>
  world.events(calendar).find((e) => e.title === title);

test('first sync creates every event in one Gemini request', () => {
  const world = newWorld();
  world.fn.sync();

  assert.equal(world.requests.length, 1);
  assert.equal(world.requests[0].notes.length, 9);
  assert.match(world.requests[0].url, /models\/gemini-flash-lite-latest:generateContent/);
  assert.equal(world.requests[0].generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.deepEqual(titles(world.events(DT)), [
    'Reduction firing',
    'reduction cooling',
    '🔴 Studio closed for the holiday',
    '🔵 Bisque loaded',
    '🔵 Bisque loading',
    '🔵 Oxidation to be loaded',
    '🟢 Unload',
  ]);
  assert.equal(world.events(JT).length, 5);
  assert.equal(world.state().length, 9);
  assert.match(world.summary(), /9 items, 0 unchanged, 9 new \(12 events added\)/);
});

test('events carry their stage color, location and timing', () => {
  const world = newWorld();
  world.fn.sync();

  assert.equal(byTitle(world, DT, '🔵 Bisque loaded').color, '6');
  assert.equal(byTitle(world, DT, '🟢 Unload').color, '11');
  assert.equal(byTitle(world, DT, '🔴 Studio closed for the holiday').color, '4');
  assert.equal(byTitle(world, DT, 'Reduction firing').color, null, 'Firing has no color');

  const unload = byTitle(world, DT, '🟢 Unload');
  assert.equal(unload.allDay, false);
  assert.equal(unload.start.getHours(), 11);
  assert.equal(unload.end - unload.start, 30 * 60 * 1000);
  assert.equal(unload.location, '499 S Market St, San Jose, CA 95113');
  assert.equal(world.events(JT)[0].location, '520 N 7th St, San Jose, CA 95112');
});

test("an event's description quotes the note, links its row and shares the calendar", () => {
  const world = newWorld();
  world.fn.sync();

  const description = byTitle(world, DT, '🔵 Bisque loading').description;
  const sections = description.split('\n\n');
  assert.equal(sections[0], 'Original note (Fri, Oct 9):');
  assert.match(
    sections[1],
    /^"Bisque loading, reduction cooling \(unload by 11am\)"\nhttps:\/\/docs\.google\.com\/spreadsheets\/d\/SHEET\/edit\?gid=1000#gid=1000&range=A7:E7$/,
  );
  assert.equal(sections[2], '─'.repeat(19));
  assert.equal(sections[3], world.eval('CONFIG.CONTACT'));
  assert.match(sections[4], /^Share this calendar:\nwebcal:\/\/calendar\.google\.com\/calendar\/ical\/.+\/public\/basic\.ics$/);
  assert.equal(sections[6], world.eval('CONFIG.DISCLAIMER'));
  assert.match(sections[7], /Check the original note before relying on an event\.$/);
});

test('the calendar description shares the calendar and links the kiln notes', () => {
  const world = newWorld();
  world.fn.sync();

  const description = world.calendars[DT].description;
  assert.ok(description.startsWith(world.eval('CONFIG.CONTACT')));
  assert.match(description, /Share this calendar:\nwebcal:\/\//);
  assert.match(description, /before relying on an event:\nhttps:\/\/docs\.google\.com\/spreadsheets\/d\/SHEET\/edit$/);
});

test('a second sync with nothing changed makes no requests and no writes', () => {
  const world = newWorld();
  world.fn.sync();
  const before = world.allEvents().map((e) => e.id);

  world.fn.sync();

  assert.equal(world.requests.length, 1);
  assert.deepEqual(world.allEvents().map((e) => e.id), before);
  assert.match(world.summary(), /9 items, 9 unchanged, 0 new/);
});

test("an edited note replaces only that note's events", () => {
  const world = newWorld();
  world.fn.sync();
  world.setCell(TAB, 6, 2, 'Bisque fired');

  world.fn.sync();

  assert.equal(world.requests.length, 2);
  assert.deepEqual(world.requests[1].notes.map((n) => n.note), ['Bisque fired']);
  assert.ok(!byTitle(world, DT, '🔵 Bisque loading'));
  assert.ok(!byTitle(world, DT, '🟢 Unload'));
  assert.ok(byTitle(world, DT, 'Bisque fired'));
  assert.equal(world.events(DT).length, 5);
  assert.match(world.summary(), /1 new \(1 events added\), 3 events removed/);
});

test("a cleared note removes its events without calling Gemini", () => {
  const world = newWorld();
  world.fn.sync();
  world.setCell(TAB, 10, 2, '');

  world.fn.sync();

  assert.equal(world.requests.length, 1);
  assert.ok(!byTitle(world, DT, '🔵 Oxidation to be loaded'));
  assert.equal(world.state().length, 8);
});

test('notes that age out of the window keep their events but are forgotten', () => {
  const world = newWorld();
  world.fn.sync();
  world.nowMs += 20 * DAY; // Thu, Oct 29: the window now starts Oct 15.

  world.fn.sync();

  assert.ok(byTitle(world, DT, '🔵 Bisque loaded'), 'Sep 25 event stays');
  assert.deepEqual(
    world.requests[1].notes.map((n) => n.note),
    ['After the window'],
    'Nov 2 entered the window',
  );
  // Oct 21 is still tracked, Nov 2 is new; everything before Oct 15 is forgotten.
  assert.equal(world.state().length, 2);
});

test('disabling a studio removes its events inside the window', () => {
  const world = newWorld();
  world.fn.sync();
  world.eval('CONFIG.STUDIOS[1].enabled = false');

  world.fn.sync();

  assert.equal(world.events(JT).length, 0);
  assert.equal(world.events(DT).length, 7);
  assert.equal(world.requests.length, 1);
  assert.match(world.summary(), /5 events removed/);
});

test('preview writes nothing', () => {
  const world = newWorld();
  world.fn.preview();

  assert.deepEqual(Object.keys(world.calendars), []);
  assert.equal(world.state().length, 0);
  assert.equal(world.requests.length, 1);
  assert.match(world.summary(), /^Preview of 2026-09-25 to 2026-10-23: 9 items, 0 unchanged, 9 new \(12 events to add\)/);
});

test('preview uses GEMINI_PREVIEW_MODEL and sync keeps GEMINI_MODEL', () => {
  const world = newWorld({
    props: { GEMINI_MODEL: 'sync-model', GEMINI_PREVIEW_MODEL: 'preview-model' },
  });
  world.fn.preview();
  world.fn.sync();

  assert.match(world.requests[0].url, /models\/preview-model:/);
  assert.match(world.requests[1].url, /models\/sync-model:/);
});

test('GEMINI_THINKING_LEVEL=default leaves the thinking setting out', () => {
  const world = newWorld({ props: { GEMINI_THINKING_LEVEL: 'default' } });
  world.fn.sync();
  assert.equal(world.requests[0].generationConfig.thinkingConfig, undefined);
  assert.ok(world.requests[0].generationConfig.responseSchema);
});

test('a 429 gives up at once and the next run retries', () => {
  const world = newWorld();
  world.gemini.failCode = 429;

  world.fn.sync();

  assert.equal(world.requests.length, 1);
  assert.deepEqual(world.sleeps, []);
  assert.equal(world.allEvents().length, 0);
  assert.equal(world.state().length, 0);
  assert.match(world.summary(), /9 failed/);

  world.gemini.failCode = null;
  world.fn.sync();
  assert.equal(world.allEvents().length, 12);
});

test('a server error is retried twice with growing waits', () => {
  const world = newWorld();
  world.gemini.failCode = 503;

  world.fn.sync();

  assert.equal(world.requests.length, 3);
  assert.deepEqual(world.sleeps, [10000, 20000]);
  assert.match(world.summary(), /9 failed/);
});

test("a note missing from Gemini's reply is retried on the next run", () => {
  const world = newWorld();
  world.gemini.drop.add('Reduction cooling');

  world.fn.sync();
  assert.match(world.summary(), /8 new .* 1 failed/);

  world.gemini.drop.clear();
  world.fn.sync();
  assert.deepEqual(world.requests[1].notes.map((n) => n.note), ['Reduction cooling']);
  assert.equal(world.state().length, 9);
});

test('running out of time leaves the rest for the next run, without duplicates', () => {
  const world = newWorld();
  const start = world.nowMs;
  let calls = 0;
  world.now = () => start + 70 * 1000 * calls++; // Every clock read costs 70 seconds.

  world.fn.sync();
  assert.match(world.summary(), /left for the next run \(out of time\)/);
  const firstRun = world.state().length;
  assert.ok(firstRun > 0 && firstRun < 9, `recorded ${firstRun} of 9`);

  world.now = () => start;
  world.fn.sync();
  assert.equal(world.state().length, 9);
  assert.equal(world.allEvents().length, 12);
});

test('new notes are split evenly across requests of at most 100', () => {
  const rows = [['Date', '', 'Downtown', 'JTown', '# OX Carts']];
  for (let day = 0; day < 65; day++) {
    const date = new Date(2026, 9, 9 + day);
    const label = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    rows.push([label, '', `Downtown ${day}`, `JTown ${day}`, '']);
  }
  const world = createWorld({
    tabs: { [TAB]: rows, 'Kiln Notes 2027': [['Date', '', 'Downtown', 'JTown']] },
    props: { SYNC_MAX_DAYS_AHEAD: '90' },
  });

  world.fn.sync();

  assert.deepEqual(world.requests.map((r) => r.notes.length), [65, 65]);
});

test('reset deletes every synced event and forceSync rebuilds them', () => {
  const world = newWorld();
  world.fn.sync();

  world.fn.reset();
  assert.equal(world.allEvents().length, 0);
  assert.equal(world.state().length, 0);
  assert.ok(world.logs.some((l) => l.text === 'Reset: deleted 12 event(s). Run sync() to rebuild.'));

  world.fn.forceSync();
  assert.equal(world.allEvents().length, 12);
  assert.equal(world.requests.length, 2);
});

test("a missing year tab fails the run instead of clearing the calendars", () => {
  const world = newWorld();
  world.fn.sync();
  world.tabs = { 'Renamed tab': kilnRows() };

  assert.throws(() => world.fn.sync(), /No tab named with "kiln" and 2026/);
  assert.equal(world.allEvents().length, 12);
});

test('sync never installs a trigger by itself', () => {
  const world = newWorld();
  world.fn.sync();
  assert.deepEqual(world.triggers, []);
});

test('the trigger follows SYNC_INTERVAL_MINUTES', () => {
  const world = newWorld();
  world.fn.installTrigger();
  assert.deepEqual(world.triggers.map((t) => t.every), ['1h']);

  world.props.SYNC_INTERVAL_MINUTES = '15';
  world.fn.sync();
  assert.deepEqual(world.triggers.map((t) => t.every), ['15m']);

  world.props.SYNC_INTERVAL_MINUTES = '20';
  assert.throws(() => world.fn.sync(), /must be one of 1, 5, 10, 15, 30/);
  assert.deepEqual(world.triggers.map((t) => t.every), ['15m']);
});

test('SYNC_MAX_DAYS_AHEAD moves the end of the window and is validated', () => {
  const world = newWorld({ props: { SYNC_MAX_DAYS_AHEAD: '30' } });
  world.fn.preview();
  assert.match(world.summary(), /to 2026-11-08: 10 items/);

  world.props.SYNC_MAX_DAYS_AHEAD = 'two weeks';
  assert.throws(() => world.fn.preview(), /whole number from 0 to 366/);
});
