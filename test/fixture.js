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

/** Notes inside the default sync window, per studio. */
const IN_WINDOW = { Downtown: 5, JTown: 4 };

module.exports = { TAB, kilnRows, IN_WINDOW };
