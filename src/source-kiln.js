/**
 * The kiln notes tab: one item per studio note per day, read from the tab named for the
 * year and parsed by Gemini into activities and timed events.
 */

const KILN_STATE_PREFIX = 'cell:';

/** @returns {Source<Cell, Parsed>} */
function kilnSource_() {
  return {
    name: 'kiln',
    statePrefix: KILN_STATE_PREFIX,
    usesModel: true,
    read: ({ today, windowStart, windowEnd }) =>
      readCells_(today, windowStart, windowEnd).map((cell) => ({
        key: cellKey_(cell),
        date: cell.date,
        calendarName: cell.studio.calendarName,
        sheetUrl: cell.sheetUrl,
        label: describe_(cell),
        payload: cell,
      })),
    parse: (cells, model) => parseNotes_(cells, model),
    createEvents: createEvents_,
    describe: describeParsed_,
    countEvents: (parsed) => parsed.activities.length + parsed.timed.length,
  };
}

/**
 * Every source the script syncs. A function, not a constant, because Apps Script loads a
 * project's files in an order the code can't rely on.
 *
 * @returns {Source<any, any>[]}
 */
function sources_() {
  return [kilnSource_(), discardSource_(), closuresSource_(), classesSource_()];
}
