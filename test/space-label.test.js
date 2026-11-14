const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');

const world = createWorld({ tabs: {} });
const space = (wheels, handBuilding = '') =>
  JSON.parse(JSON.stringify(world.fn.spaceLabel_(wheels, handBuilding)));
const label = (wheels, handBuilding) => space(wheels, handBuilding)?.label ?? null;

test('the label is just the number of people', () => {
  assert.equal(label('18', ''), '18');
  assert.equal(label(' 12 ', ''), '12');
  assert.equal(label('', '8 seats plus tools'), '8');
  assert.equal(label('', '12 seats Hand-building'), '12');
  assert.equal(label('15 people, mostly glaze area', ''), '15');
});

test('wheels and seats together show the number once', () => {
  assert.equal(label('9', '9 seats + tools'), '9');
  assert.equal(label('10', 'all but the low tables near the front'), '10');
  assert.equal(label('18', 'all of glaze area'), '18');
  assert.equal(label('10 (2-3pm)', 'all of HB 2:30-4pm'), '10');
});

test('without a number there is no label, but the event still takes space', () => {
  assert.equal(label('', 'all of HB'), '');
  assert.equal(label('', 'all of glaze area'), '');
  assert.equal(label('', 'Hand-building'), '');
  assert.equal(label('', 'all but low tables near door'), '');
});

test('an event that takes no space has nothing at all', () => {
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

test('a zero in the wheels cell means no wheels', () => {
  assert.equal(label('0', ''), '');
  assert.equal(label('0', '8 seats plus tools'), '8');
  assert.equal(label('0', 'all of HB'), '');
  assert.equal(space('0', '8 seats plus tools').detail, 'Space taken: 0 wheels; 8 seats plus tools');
});
