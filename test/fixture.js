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
};
