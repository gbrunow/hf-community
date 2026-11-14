const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');
const { TAB, kilnRows } = require('./fixture');

const DAY = 24 * 60 * 60 * 1000;
const FAKE = 'Fake Calendar';

/** A source whose items belong to no single day, like a tab-level list. */
function fakeSource(world, { items, failParse = false }) {
  return {
    name: 'fake',
    statePrefix: 'fake:',
    read: () =>
      items.map((text) => ({
        key: `key-${text}`,
        date: null,
        calendarName: FAKE,
        sheetUrl: 'https://example.test/sheet',
        label: `fake "${text}"`,
        payload: text,
      })),
    parse: (payloads) => {
      // Built in the script's own realm, as errors are in Apps Script, so instanceof Error holds.
      if (failParse) throw new (world.eval('Error'))('fake failure');
      return payloads.map((text) => ({ text }));
    },
    createEvents: (calendar, text) => [
      calendar.createAllDayEvent(text, new Date(2026, 11, 1), {}).getId(),
    ],
    describe: (result) => result.text,
    countEvents: () => 1,
  };
}

/** A world syncing the kiln tab plus a fake source, whose items the test controls. */
function worldWithFake(options = {}) {
  const world = createWorld({ tabs: { [TAB]: kilnRows() } });
  const fake = { items: ['first'], failParse: false, fakeFirst: false, ...options };
  world.fake = fake;
  world.context.sources_ = () => {
    const sources = [world.context.kilnSource_(), fakeSource(world, fake)];
    return fake.fakeFirst ? sources.reverse() : sources;
  };
  return world;
}

const fakeTitles = (world) => world.events(FAKE).map((e) => e.title).sort();

test('an item without a date is created once and survives the window moving on', () => {
  const world = worldWithFake();
  world.fn.sync();
  assert.deepEqual(fakeTitles(world), ['first']);

  world.nowMs += 40 * DAY;
  world.fn.sync();
  world.fn.sync();

  assert.deepEqual(fakeTitles(world), ['first'], 'not recreated');
  assert.equal(world.props['fake:key-first'] !== undefined, true, 'still tracked');
});

test('an item without a date is removed when it disappears, at any age', () => {
  const world = worldWithFake();
  world.fn.sync();
  world.nowMs += 40 * DAY;
  world.fake.items = ['second'];

  world.fn.sync();

  assert.deepEqual(fakeTitles(world), ['second']);
  assert.equal(world.props['fake:key-first'], undefined);
  assert.match(world.summary(), /1 events removed/);
});

test("each source keeps its own state, and the kiln source keeps the cell: prefix", () => {
  const world = worldWithFake();
  world.fn.sync();

  assert.equal(world.state().length, 9);
  assert.ok(Object.keys(world.props).includes('fake:key-first'));
  assert.match(world.summary(), /10 items, 0 unchanged, 10 new/);
});

test('reset clears every source', () => {
  const world = worldWithFake();
  world.fn.sync();

  world.fn.reset();

  assert.equal(world.allEvents().length, 0);
  assert.deepEqual(
    Object.keys(world.props).filter((k) => /^(cell|fake):/.test(k)),
    [],
  );
});

test("a source that fails doesn't stop the sources after it", () => {
  const world = worldWithFake({ failParse: true, fakeFirst: true });

  world.fn.sync();

  assert.equal(world.events(FAKE).length, 0);
  assert.equal(world.allEvents().length, 12, 'kiln events still created');
  assert.match(world.summary(), /1 failed/);
  assert.ok(world.logs.some((l) => /Skipping 1 fake item\(s\) until the next run: fake failure/.test(l.text)));

  world.fake.failParse = false;
  world.fn.sync();
  assert.deepEqual(fakeTitles(world), ['first']);
});

test('running out of time defers the later sources', () => {
  const world = worldWithFake();
  const start = world.nowMs;
  let calls = 0;
  // The first clock reads (the run's start and the first checks) are cheap; then each costs 5 minutes.
  world.now = () => start + (calls++ < 3 ? 0 : 5 * 60 * 1000);

  world.fn.sync();

  assert.equal(world.events(FAKE).length, 0);
  assert.match(world.summary(), /left for the next run \(out of time\)/);

  world.now = () => start;
  world.fn.sync();
  assert.deepEqual(fakeTitles(world), ['first']);
});

test('a source that cannot be read fails the run before anything is written', () => {
  const world = worldWithFake();
  world.fn.sync();
  const before = world.allEvents().length;
  world.context.sources_ = () => [
    world.context.kilnSource_(),
    {
      ...fakeSource(world, world.fake),
      read: () => {
        throw new Error('tab missing');
      },
    },
  ];
  world.setCell(TAB, 6, 2, 'Bisque fired');

  assert.throws(() => world.fn.sync(), /tab missing/);
  assert.equal(world.allEvents().length, before, 'the kiln edit was not applied either');
});

/** A source of dated items that records the window it was asked to read. */
function datedSource(world, { items, lookaheadDays, windows }) {
  return {
    name: 'dated',
    statePrefix: 'dated:',
    lookaheadDays,
    read: (window) => {
      windows.push(window);
      return items.map(({ text, days }) => ({
        key: `key-${text}`,
        date: new Date(window.today.getFullYear(), window.today.getMonth(), window.today.getDate() + days),
        calendarName: FAKE,
        sheetUrl: 'https://example.test/sheet',
        label: `dated "${text}"`,
        payload: text,
      }));
    },
    parse: (payloads) => payloads.map((text) => ({ text })),
    createEvents: (calendar, text) => [
      calendar.createAllDayEvent(text, new Date(2026, 11, 1), {}).getId(),
    ],
    describe: (result) => result.text,
    countEvents: () => 1,
  };
}

test("a source's own look-ahead sets its window and how far removal reaches", () => {
  const world = createWorld({ tabs: { [TAB]: kilnRows() } });
  const windows = [];
  const dated = { items: [{ text: 'far', days: 100 }], lookaheadDays: 180, windows };
  world.context.sources_ = () => [datedSource(world, dated)];

  world.fn.sync();
  assert.equal(world.fn.isoDate_(windows[0].windowEnd), '2027-04-07', '180 days from Oct 9');
  assert.deepEqual(fakeTitles(world), ['far']);

  // 100 days out is far beyond the global 14-day window, yet an edit must still replace it.
  dated.items = [{ text: 'edited', days: 100 }];
  world.fn.sync();
  assert.deepEqual(fakeTitles(world), ['edited']);

  dated.items = [];
  world.fn.sync();
  assert.deepEqual(fakeTitles(world), []);
});

test('a source without its own look-ahead gets the global window', () => {
  const world = createWorld({ tabs: { [TAB]: kilnRows() } });
  const windows = [];
  world.context.sources_ = () => [datedSource(world, { items: [], windows })];

  world.fn.sync();

  assert.equal(world.fn.isoDate_(windows[0].windowEnd), '2026-10-23');
});

test('the summary names the model only when a source that calls Gemini had work', () => {
  const world = createWorld({ tabs: { [TAB]: kilnRows() } });
  world.fn.sync();
  assert.match(world.summary(), /Model: gemini-flash-lite-latest\.$/);

  world.fn.sync();
  assert.doesNotMatch(world.summary(), /Model:/, 'nothing new to parse');

  const plain = createWorld({ tabs: { [TAB]: kilnRows() } });
  plain.context.sources_ = () => [datedSource(plain, { items: [{ text: 'x', days: 0 }], windows: [] })];
  plain.fn.sync();
  assert.doesNotMatch(plain.summary(), /Model:/, 'a source that never calls Gemini');
});

test("a source's own request size caps how many of its items go to parse at once", () => {
  const world = createWorld({ tabs: { [TAB]: kilnRows() } });
  const sizes = [];
  const source = fakeSource(world, { items: Array.from({ length: 10 }, (_, i) => `item ${i}`) });
  source.maxItemsPerRequest = 4;
  const parse = source.parse;
  source.parse = (payloads, model) => {
    sizes.push(payloads.length);
    return parse(payloads, model);
  };
  world.context.sources_ = () => [source];

  world.fn.sync();

  assert.deepEqual(sizes, [4, 4, 2]);
  assert.equal(fakeTitles(world).length, 10);
});
