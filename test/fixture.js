// A made-up kiln notes tab shaped like the studio's: title rows, a "Date" header row, one
// column per studio and an extra column. "Today" in the tests is Fri, Oct 9, 2026; sync
// looks back 14 days (to Sep 25) and ahead 14 (to Oct 23).

const TAB = 'Kiln Notes 2026';

function kilnRows() {
  return [
    ['', '', '', '', ''],
    ['-- KILN NOTES 2026 --', '', '', '', ''],
    ['Date', '', 'Downtown', 'JTown', '# OX Carts'],
    ['Mon, Sep 21', '', 'Before the window', '', ''], // row 4
    ['Fri, Sep 25', '', 'Bisque loaded', 'Reduction firing', '1'], // row 5
    ['Thu, Oct 8', '', 'Reduction firing', 'Bisque unloaded, reduction loading', ''], // row 6
    ['Fri, Oct 9', '', 'Bisque loading, reduction cooling (unload by 11am)', '  Reduction   to be fired ', ''], // row 7
    ['Sat, Oct 10', '', '', 'Reduction cooling', ''], // row 8
    ['Sun, Oct 11', '', '', '', ''], // row 9
    ['Mon, Oct 12', '', 'Studio closed for the holiday', '', ''], // row 10
    ['Wed, Oct 21', '', 'Oxidation to be loaded', '', ''], // row 11
    ['Mon, Nov 2', '', 'After the window', '', ''], // row 12
  ];
}

const DISCARD_TAB_DT = 'Pottery Discard Schedule DT';
// The real JTown tab's name has a leading space.
const DISCARD_TAB_JT = ' Pottery Discard Schedule JT';

/** Downtown writes full dates. */
function discardRowsDT() {
  return [
    ['DT Studio Work Discard Schedule', ''],
    ['Work Type', 'Hold Time'],
    ['Bisque-fired work', '2 months'],
    ['Upcoming Discard Dates', ''],
    ['Greenware: ', 'Ongoing - work is checked/labeled weekly'],
    ['Bisque:  ', '9/14/2026', '11/13/2026', '1/12/2027'],
    ['Glazed Fired Work:', '9/14/2026', '11/13/2026', '1/12/2027'],
  ];
}

/** JTown writes a list of month-day pairs with no years. */
function discardRowsJT() {
  const list = 'Oct 1 →  Dec 1→  Feb 1→  Apr 1→  Jun 1→  Aug 1  → Oct 1  → Dec 1';
  return [
    ['JT Studio Work Discard Schedule', ''],
    ['Upcoming Toss Dates', ''],
    ['Greenware: ', 'Ongoing - work is checked/labeled weekly'],
    ['Bisque:  ', list],
    ['Glazed Fired Work:', list],
  ];
}

const EVENTS_TAB = 'DT Events 2026';

/** One row of the events tab: the table in columns A-I, a side-table entry from column N. */
function eventsRow({ date = '', start = '', end = '', event = '', wheels = '', hb = '', side = [] } = {}) {
  const row = Array(18).fill('');
  row[0] = date;
  row[2] = start;
  row[3] = end;
  row[5] = event;
  row[6] = wheels;
  row[7] = hb;
  side.forEach((text, i) => {
    row[[13, 15, 16, 17][i]] = text;
  });
  return row;
}

/**
 * A made-up Downtown events tab. "Today" in the tests is Fri, Oct 9, 2026: classes are
 * synced 60 days ahead (to Dec 8), closures and workshops 180 days ahead.
 */
function eventsRows() {
  return [
    Array(18).fill(''),
    ['-- DOWNTOWN EVENTS --', ...Array(17).fill('')],
    eventsRow({ date: 'Date', start: 'Start', end: 'End', event: 'Event', wheels: '# of Wheels', hb: 'Hand-building' }),
    eventsRow({ date: 'Thu, Oct 8', start: '7:00 PM', end: '10:00 PM', event: 'Just Try It', wheels: '18' }), // row 4
    eventsRow({ date: 'Fri, Oct 9', start: '2:00 PM', end: '4:00 PM', event: 'Wheel Package', wheels: '20' }), // row 5
    eventsRow({ start: '6:00 PM', end: '9:00 PM', event: 'Hand-building Sampler', hb: 'all of HB' }), // row 6: the date above
    eventsRow({ date: 'Sat, Oct 10', start: '10:00 AM', end: '1:00 PM', event: 'Just Try It', wheels: '18' }), // row 7
    eventsRow({ start: '3:00 AM', end: '5:00 AM', event: 'Take a Spin', wheels: '6' }), // row 8: AM typo
    eventsRow({ date: 'Mon, Oct 12', start: 'STUDIO CLOSED FOR THE HOLIDAY' }), // row 9
    eventsRow({ date: 'Tue, Oct 13', start: '10:00 AM', end: '12:00 PM', event: 'Mug & Bowl Pkg', wheels: '9', hb: '9 seats + tools' }), // row 10
    eventsRow({ date: 'Wed, Oct 14', start: '7:00 PM', end: '10:00 PM', event: 'Just Try It', wheels: '18' }), // row 11
    eventsRow({ start: '5:30 Closure', end: 'Studio closes early for an offsite' }), // row 12: the date above
    eventsRow({ side: ['Sat, Nov 7', '10am-1pm', 'Extruder 1 with Sam Rivera', 'Hand-building'] }), // row 13
    eventsRow({ date: 'Sat, Dec 12', start: '10:00 AM', end: '1:00 PM', event: 'Just Try It', wheels: '18' }), // row 14: past 60 days
    eventsRow({ date: 'Fri, Dec 25', start: 'STUDIO CLOSED FOR CHRISTMAS' }), // row 15
  ];
}

/** The kiln tab (always needed) and the events tab. */
function eventsTabs() {
  return { [TAB]: kilnRows(), [EVENTS_TAB]: eventsRows() };
}

/** Both studios' tabs together with the kiln tab. */
function allTabs() {
  return {
    [TAB]: kilnRows(),
    [DISCARD_TAB_DT]: discardRowsDT(),
    [DISCARD_TAB_JT]: discardRowsJT(),
  };
}

/** Notes inside the default sync window, per studio. */
const IN_WINDOW = { Downtown: 5, JTown: 4 };

module.exports = {
  TAB,
  kilnRows,
  IN_WINDOW,
  DISCARD_TAB_DT,
  DISCARD_TAB_JT,
  discardRowsDT,
  discardRowsJT,
  allTabs,
  EVENTS_TAB,
  eventsRows,
  eventsRow,
  eventsTabs,
};
