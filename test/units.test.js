const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');
const { TAB, kilnRows } = require('./fixture');

const world = createWorld({ tabs: { [TAB]: kilnRows() } });
const fn = world.fn;
const date = (y, m, d) => new world.context.Date(y, m - 1, d);
const iso = (d) => fn.isoDate_(d);
// Values built inside the script's sandbox have its own Array/Object prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('parseRowDate_ reads the sheet date with or without a weekday', () => {
  assert.equal(iso(fn.parseRowDate_('Fri, Oct 9', 2026)), '2026-10-09');
  assert.equal(iso(fn.parseRowDate_('Oct 9', 2026)), '2026-10-09');
  assert.equal(iso(fn.parseRowDate_('Wed August 19', 2026)), '2026-08-19');
  assert.equal(iso(fn.parseRowDate_('  Thu, Dec 31 ', 2026)), '2026-12-31');
});

test('parseRowDate_ rejects rows that are not dates', () => {
  for (const value of ['', 'Date', '-- KILN NOTES 2026 --', 'Foo 12', 'Oct']) {
    assert.equal(fn.parseRowDate_(value, 2026), null, value);
  }
});

test("findYearTab_ matches the year's kiln tab loosely", () => {
  const sheets = (...names) => names.map((name) => ({ getName: () => name }));
  const real = ['DT Events 2026', 'JTown Events 2026', 'Show Prep Timeline'];
  const found = (names, year) => fn.findYearTab_(sheets(...names), year)?.getName();

  assert.equal(found([...real, 'Kiln Notes 2026'], 2026), 'Kiln Notes 2026');
  assert.equal(found([...real, 'KILN notes 2027 '], 2027), 'KILN notes 2027 ');
  assert.equal(found([...real, 'Kiln Notes 2026'], 2027), undefined);
  assert.throws(
    () => fn.findYearTab_(sheets('Kiln Notes 2026', 'Copy of Kiln Notes 2026'), 2026),
    /Several tabs match 2026/,
  );
});

test('cellsFromRows_ finds studio columns by header name, wherever they are', () => {
  const rows = [
    ['Date', '', 'Downtown', '# OX Carts', '', 'JTown'],
    ['Fri, Oct 9', '', 'Downtown note', '2', '', 'JTown note'],
  ];
  const cells = fn.cellsFromRows_(rows, 2026, date(2026, 10, 1), date(2026, 10, 31));
  assert.deepEqual(
    plain(cells.map((c) => [c.studio.header, c.text])),
    [
      ['Downtown', 'Downtown note'],
      ['JTown', 'JTown note'],
    ],
  );
});

test('cellsFromRows_ fails loudly when a studio column is missing', () => {
  const rows = [['Date', '', 'Downtown'], ['Fri, Oct 9', '', 'note']];
  assert.throws(
    () => fn.cellsFromRows_(rows, 2026, date(2026, 10, 1), date(2026, 10, 31)),
    /No "JTown" column/,
  );
  assert.throws(
    () => fn.cellsFromRows_([['Day'], ['Fri, Oct 9']], 2026, date(2026, 10, 1), date(2026, 10, 31)),
    /No header row/,
  );
});

test('cellsFromRows_ keeps only the window, skips blanks and normalizes spaces', () => {
  const cells = fn.cellsFromRows_(kilnRows(), 2026, date(2026, 9, 25), date(2026, 10, 23));
  const texts = cells.map((c) => c.text);
  assert.ok(!texts.includes('Before the window'));
  assert.ok(!texts.includes('After the window'));
  assert.ok(texts.includes('Reduction to be fired'), 'collapses runs of spaces');
  assert.equal(cells.length, 9);
});

test('cellsFromRows_ selects the whole row, up to the last column with a header', () => {
  const cells = fn.cellsFromRows_(kilnRows(), 2026, date(2026, 10, 9), date(2026, 10, 9));
  assert.deepEqual(
    plain(cells.map((c) => c.rowRange)),
    ['A7:E7', 'A7:E7'],
  );
  assert.equal(cells[0].dateLabel, 'Fri, Oct 9');
});

test('columnLetter_ converts zero-based indexes like a spreadsheet', () => {
  const letters = [0, 4, 25, 26, 27, 51, 52, 701, 702].map(fn.columnLetter_);
  assert.deepEqual(letters, ['A', 'E', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('validateParsed_ drops malformed or implausibly distant timed items', () => {
  const cell = { date: date(2026, 10, 9), text: 'raw note' };
  const parsed = fn.validateParsed_(
    {
      events: [
        { title: '  Bisque loading ', date: '2026-10-09' },
        { title: '', date: '2026-10-09' },
        { title: 'Unload', date: '2026-10-10', time: '11:00' },
        { title: 'Bad time', date: '2026-10-10', time: '25:00' },
        { title: 'Bad date', date: 'Oct 10', time: '11:00' },
        { title: 'No date', time: '11:00' },
        { title: 'Too far', date: '2027-10-10', time: '11:00' },
      ],
    },
    cell,
  );
  assert.deepEqual(plain(parsed), {
    activities: ['Bisque loading'],
    timed: [{ title: 'Unload', date: '2026-10-10', time: '11:00' }],
  });
});

test('validateParsed_ falls back to the raw note when nothing usable is left', () => {
  const cell = { date: date(2026, 10, 9), text: 'raw note' };
  for (const reply of [{}, { events: [] }, { events: [{ title: '  ', date: '2026-10-09' }] }]) {
    assert.deepEqual([...fn.validateParsed_(reply, cell).activities], ['raw note']);
  }
});

test('stageOf_ checks unloading before loading', () => {
  const stage = (title) => fn.stageOf_(title)?.name ?? null;
  assert.equal(stage('Bisque unloaded'), 'Unloading');
  assert.equal(stage('Reduction unload (late)'), 'Unloading');
  assert.equal(stage('Lowfire bisque unloading'), 'Unloading');
  assert.equal(stage('Bisque loaded'), 'Loading');
  assert.equal(stage('Oxidation to be loaded'), 'Loading');
});

test('stageOf_ recognizes every stage and leaves the rest alone', () => {
  const stage = (title) => fn.stageOf_(title)?.name ?? null;
  assert.equal(stage('Studio closed for the holiday'), 'Closure');
  assert.equal(stage('Studio closes early'), 'Closure');
  assert.equal(stage('Reduction cooling'), 'Cooling');
  assert.equal(stage('Reduction to be fired'), 'Firing');
  assert.equal(stage('Fire bisque'), 'Firing');
  assert.equal(stage('Cart 3 introduced!'), null);
});

test('describeParsed_ lists events with their stage', () => {
  const text = fn.describeParsed_({
    activities: ['Bisque loading'],
    timed: [{ title: 'Reduction unload', date: '2026-10-10', time: '11:00' }],
  });
  assert.equal(
    text,
    'Bisque loading [Loading] · 2026-10-10 11:00 Reduction unload [Unloading]',
  );
});

test('cellKey_ changes with studio, date or text, and only those', () => {
  const studio = (header) => ({ header });
  const base = { studio: studio('Downtown'), date: date(2026, 10, 9), text: 'note', rowRange: 'A7:E7' };
  const key = fn.cellKey_(base);
  assert.equal(fn.cellKey_({ ...base, rowRange: 'A8:E8' }), key, 'moving rows is not an edit');
  assert.notEqual(fn.cellKey_({ ...base, studio: studio('JTown') }), key);
  assert.notEqual(fn.cellKey_({ ...base, date: date(2026, 10, 10) }), key);
  assert.notEqual(fn.cellKey_({ ...base, text: 'note!' }), key);
});

test('every configured stage color is a valid legacy color ID', () => {
  for (const stage of world.eval('CONFIG.STAGES')) {
    if (stage.colorId === undefined) continue;
    assert.match(String(stage.colorId), /^([1-9]|1[01])$/, stage.name);
  }
});
