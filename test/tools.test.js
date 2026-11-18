const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness');

const DT = 'Higher Fire · Kiln Notes & Events';
const CLASSES = 'Higher Fire · Classes';
const feedLink = (id) => `webcal://calendar.google.com/calendar/ical/${id}%40group.calendar.google.com/public/basic.ics`;

test('subscribeLinks() lists both Downtown calendars and says which is not public yet', () => {
  const world = createWorld({ tabs: {} });
  world.eval('CONFIG.STUDIOS.forEach((studio) => { studio.enabled = studio.header === "Downtown"; })');
  world.context.CalendarApp.createCalendar(DT);
  world.context.CalendarApp.createCalendar(CLASSES);
  world.publicCalendars.add(DT);

  world.fn.subscribeLinks();

  assert.deepEqual(
    world.logs.map((l) => l.text),
    [
      `${DT}: ${feedLink('HigherFireKilnNotesEvents')}`,
      `${CLASSES}: ${feedLink('HigherFireClasses')}\n  Not public yet, so this link won't work until it is.`,
    ],
  );
});
