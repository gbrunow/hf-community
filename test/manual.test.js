const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');
const { TAB, EVENTS_TAB, eventsTabs, allTabs, eventsRow } = require('./fixture');

const DT = 'Higher Fire · Kiln Notes & Events';
const CLASSES = 'Higher Fire · Classes';

/**
 * A world with a few events made by hand, as a person adds them in the calendar app: some
 * inside the sync window and some far outside it, on the main and the classes calendars,
 * one sharing a script event's exact title and time.
 */
function worldWithManualEvents(options = {}) {
  const world = createWorld({ tabs: { ...eventsTabs(), ...allTabs() }, ...options });
  const CalendarApp = world.context.CalendarApp;
  const main = CalendarApp.createCalendar(world.eval('CONFIG.STUDIOS[0].calendarName'));
  const classes = CalendarApp.createCalendar(world.eval('CONFIG.STUDIOS[0].classesCalendarName'));
  const day = (m, d) => new (world.eval('Date'))(2026, m - 1, d);
  world.manual = [
    main.createAllDayEvent('Dentist (mine)', day(10, 12), { description: 'my own note' }),
    main.createAllDayEvent('Pick up my bowls', day(11, 20), {}),
    main.createAllDayEvent('Old reminder', day(8, 3), { description: 'from the summer' }),
    classes.createAllDayEvent('Study group', day(10, 14), { description: 'not a class' }),
    // Same title and day as a class the script makes, but made by hand.
    classes.createEvent('Just Try It · 18', new (world.eval('Date'))(2026, 9, 10, 10, 0), new (world.eval('Date'))(2026, 9, 10, 13, 0), {}),
  ].map((event) => event.getId());
  world.manualTitles = () =>
    [...world.events(DT), ...world.events(CLASSES)]
      .filter((e) => world.manual.includes(e.id))
      .map((e) => e.title)
      .sort();
  world.expectManualIntact = () =>
    assert.deepEqual(world.manualTitles(), [
      'Dentist (mine)',
      'Just Try It · 18',
      'Old reminder',
      'Pick up my bowls',
      'Study group',
    ]);
  return world;
}

test('a sync, and a second one, leave hand-made events alone', () => {
  const world = worldWithManualEvents();
  world.fn.sync();
  world.fn.sync();
  world.expectManualIntact();
  assert.ok(world.events(CLASSES).length > 5, 'and the script made its own');
});

test('editing or clearing a note replaces only the script\'s events', () => {
  const world = worldWithManualEvents();
  world.fn.sync();
  world.tabs[TAB][5][2] = 'Bisque fired'; // an edit
  world.tabs[TAB][9][2] = ''; // a cleared note
  world.tabs[EVENTS_TAB][3] = eventsRow({ date: 'Thu, Oct 8', start: '8:00 PM', end: '10:00 PM', event: 'Just Try It', wheels: '12' });

  world.fn.sync();

  world.expectManualIntact();
});

test('reset, resetSource and forceSync delete what the script made and nothing else', () => {
  const world = worldWithManualEvents();
  world.fn.sync();

  world.fn.resetSource('classes');
  world.expectManualIntact();
  assert.equal(world.events(CLASSES).filter((e) => !world.manual.includes(e.id)).length, 0);

  world.fn.sync();
  world.fn.forceSync();
  world.expectManualIntact();

  world.fn.reset();
  world.expectManualIntact();
  assert.deepEqual(
    world.allEvents().filter((e) => !world.manual.includes(e.id)),
    [],
    'every event the script made is gone, and only those',
  );
});

test('turning a studio off removes its events but not hand-made ones', () => {
  const world = worldWithManualEvents();
  world.fn.sync();
  world.eval('CONFIG.STUDIOS[0].enabled = false');

  world.fn.sync();

  world.expectManualIntact();
});

test('renaming a calendar keeps its hand-made events', () => {
  const world = worldWithManualEvents();
  world.fn.sync();
  world.fn.renameCalendar(DT, 'Renamed main');
  world.eval("CONFIG.STUDIOS[0].calendarName = 'Renamed main'");

  world.fn.sync();

  assert.deepEqual(
    world.events('Renamed main').filter((e) => world.manual.includes(e.id)).map((e) => e.title).sort(),
    ['Dentist (mine)', 'Old reminder', 'Pick up my bowls'],
  );
});

test('cleaning up after a failed run leaves hand-made events alone', () => {
  const world = worldWithManualEvents();
  world.fn.sync();
  world.fn.resetSource('closures');
  // Fail while creating the closure events, after the first one is made.
  const calendar = world.calendars[DT];
  const make = calendar.createAllDayEvent;
  let made = 0;
  calendar.createAllDayEvent = (...args) => {
    if (args[0].includes('Thanksgiving') || ++made > 1) throw new (world.eval('Error'))('quota');
    return make(...args);
  };

  world.fn.sync();
  calendar.createAllDayEvent = make;

  world.expectManualIntact();
});

test('the cleanup of untracked events removes the script\'s leftovers, not hand-made events', () => {
  const world = worldWithManualEvents();
  world.fn.sync();
  const description = world.events(CLASSES).find((e) => !world.manual.includes(e.id)).description;
  // A leftover the script made (it carries the script's description) and one made by hand.
  world.calendars[CLASSES].createAllDayEvent('Leftover copy', new (world.eval('Date'))(2026, 9, 20), { description });
  world.calendars[CLASSES].createAllDayEvent('Another handmade one', new (world.eval('Date'))(2026, 9, 20), {});
  const before = world.allEvents().length;

  world.fn.removeUntrackedEvents();

  assert.equal(world.allEvents().length, before - 1, 'only the leftover went');
  assert.ok(!world.events(CLASSES).some((e) => e.title === 'Leftover copy'));
  assert.ok(world.events(CLASSES).some((e) => e.title === 'Another handmade one'));
  world.expectManualIntact();
});

test('the checks report the script\'s events only, and say how many are by hand', () => {
  const world = worldWithManualEvents();
  world.fn.sync();
  // Two identical hand-made events are not duplicates the script should worry about.
  world.calendars[CLASSES].createAllDayEvent('Twice by hand', new (world.eval('Date'))(2026, 9, 20), {});
  world.calendars[CLASSES].createAllDayEvent('Twice by hand', new (world.eval('Date'))(2026, 9, 20), {});

  assert.deepEqual(Array.from(world.fn.findDuplicateEvents()).map((l) => l.replace(/\d+/, 'N')), ['No duplicates among N events.']);
  const untracked = Array.from(world.fn.findUntrackedEvents());
  assert.equal(untracked.length, 1);
  assert.match(untracked[0], /^Every one of \d+ events the script made is tracked, \d+ made by hand and left alone\.$/);
});

test('every event any source makes carries the marker the cleanup relies on', () => {
  const world = createWorld({ tabs: { ...eventsTabs(), ...allTabs() } });
  world.fn.sync();

  const events = world.allEvents();
  assert.ok(events.length > 20);
  const unmarked = events.filter((e) => !e.description.includes(world.eval('CONFIG.DISCLAIMER')));
  assert.deepEqual(unmarked.map((e) => e.title), []);
});
