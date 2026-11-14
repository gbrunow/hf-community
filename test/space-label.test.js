const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');

const world = createWorld({ tabs: {} });
const space = (wheels, handBuilding = '') =>
  JSON.parse(JSON.stringify(world.fn.spaceLabel_(wheels, handBuilding)));
const label = (wheels, handBuilding) => space(wheels, handBuilding)?.label ?? null;

test('wheels alone give a count', () => {
  assert.equal(label('18', ''), '18 W');
  assert.equal(label('4', ''), '4 W');
  assert.equal(label(' 12 ', ''), '12 W');
});

test('hand-building alone keeps its count or says all', () => {
  assert.equal(label('', '8 seats plus tools'), '8 HB');
  assert.equal(label('', '9 seats + tools'), '9 HB');
  assert.equal(label('', '12 seats Hand-building'), '12 HB');
  assert.equal(label('', 'all of HB'), 'all HB');
  assert.equal(label('', 'all of HB (2nd hour only)'), 'all HB');
  assert.equal(label('', 'Hand-building'), 'HB');
  assert.equal(label('', 'all but low tables near door'), 'HB');
});

test('wheels plus another area name the area without a count', () => {
  assert.equal(label('9', '9 seats + tools'), '9 W + HB');
  assert.equal(label('10', 'all but the low tables near the front'), '10 W + HB');
  assert.equal(label('13', 'all of HB'), '13 W + HB');
  assert.equal(label('18', 'all of glaze area'), '18 W + G');
});

test('the glaze area on its own, and a glaze headcount in the wheels cell', () => {
  assert.equal(label('', 'all of glaze area'), 'all G');
  assert.equal(label('', 'glaze area'), 'G');
  assert.equal(label('15 people, mostly glaze area', ''), '15 G');
});

test('a note inside the wheels cell does not change the count', () => {
  assert.equal(label('10 (2-3pm)', 'all of HB 2:30-4pm'), '10 W + HB');
});

test('an event that takes no space has no label', () => {
  assert.equal(space('', ''), null);
  assert.equal(space('  ', ' '), null);
});

test('the detail repeats the cells as written', () => {
  assert.equal(space('18').detail, 'Space taken: 18 wheels');
  assert.equal(space('9', '9 seats + tools').detail, 'Space taken: 9 wheels; 9 seats + tools');
  assert.equal(space('', 'all of HB, 2:30-4pm').detail, 'Space taken: all of HB, 2:30-4pm');
  assert.equal(
    space('10 (2-3pm)', 'all of HB 2:30-4pm').detail,
    'Space taken: 10 (2-3pm); all of HB 2:30-4pm',
  );
  assert.equal(
    space('15 people, mostly glaze area').detail,
    'Space taken: 15 people, mostly glaze area',
  );
});
