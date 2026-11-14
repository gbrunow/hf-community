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
  assert.equal(space('0', ''), null);
});

test('the detail lists a line per column under a heading', () => {
  assert.equal(space('18').detail, 'Space taken:\nWheels: 18');
  assert.equal(
    space('10', 'all but low tables near front').detail,
    'Space taken:\nWheels: 10\nHand-building: all but low tables near front',
  );
  assert.equal(space('9', '9 seats + tools').detail, 'Space taken:\nWheels: 9\nHand-building: 9 seats + tools');
  assert.equal(space('', 'all of HB, 2:30-4pm').detail, 'Space taken:\nHand-building: all of HB, 2:30-4pm');
  assert.equal(
    space('10 (2-3pm)', 'all of HB 2:30-4pm').detail,
    'Space taken:\nWheels: 10 (2-3pm)\nHand-building: all of HB 2:30-4pm',
  );
});

test('glazing is a note on the class, not a line for a column', () => {
  assert.equal(space('18', 'all of glaze area').detail, 'Space taken:\nWheels: 18\nClass will be glazing.');
  assert.equal(space('', 'all of glaze area').detail, 'Space taken:\nClass will be glazing.');
  assert.equal(
    space('15 people, mostly glaze area').detail,
    'Space taken:\nPeople: 15\nClass will be glazing.',
  );
});

test('a bare "Hand-building" cell names the area, and a zero in the wheels cell is skipped', () => {
  assert.equal(space('', 'Hand-building').detail, 'Space taken:\nHand-building area');
  assert.equal(space('0', '8 seats plus tools').detail, 'Space taken:\nHand-building: 8 seats plus tools');
});
