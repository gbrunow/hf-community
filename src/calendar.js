/**
 * @param {StudioCalendar} calendar
 * @param {Cell} cell
 * @param {Parsed} parsed
 * @returns {string[]}
 */
function createEvents_(calendar, cell, parsed) {
  const description = eventDescription_(
    calendar,
    `Original note (${cell.dateLabel}):\n\n"${cell.text}"\n${cell.rowUrl}`,
    'Check the original note before relying on an event.',
  );
  const options = { description, location: cell.studio.location };
  /** @type {{ style: EventStyle | null, event: CalendarEventHandle }[]} */
  const events = [];
  for (const activity of parsed.activities) {
    const { style, title } = styledTitle_(activity);
    events.push({
      style,
      event: calendar.createAllDayEvent(title, cell.date, options),
    });
  }
  for (const item of parsed.timed) {
    const start = dateAt_(item.date, item.time);
    const end = new Date(start.getTime() + CONFIG.TIMED_EVENT_MINUTES * 60000);
    const { style, title } = styledTitle_(item.title);
    events.push({
      style,
      event: calendar.createEvent(title, start, end, options),
    });
  }
  for (const { style, event } of events) styleEvent_(event, style);
  return events.map(({ event }) => event.getId());
}

/**
 * The matching style's optional emoji prefixes the title, carrying the style to clients
 * that ignore event colors (Apple Calendar).
 *
 * @param {string} title
 * @returns {{ style: EventStyle | null, title: string }}
 */
function styledTitle_(title) {
  const style = styleOf_(title);
  return { style, title: style?.emoji ? `${style.emoji} ${title}` : title };
}

/**
 * @param {CalendarEventHandle} event
 * @param {EventStyle | null} style
 */
function styleEvent_(event, style) {
  if (style?.colorId) event.setColor(String(style.colorId));
}

/**
 * @param {string} title
 * @returns {EventStyle | null} the first style in CONFIG.EVENT_STYLES whose pattern matches
 */
function styleOf_(title) {
  return CONFIG.EVENT_STYLES.find((style) => style.pattern.test(title)) || null;
}

/**
 * @param {SyncedEntry} entry
 */
function deleteEvents_(entry) {
  const calendar = CalendarApp.getCalendarsByName(entry.calendarName)[0];
  if (!calendar) return;
  for (const id of entry.ids) {
    const event = calendar.getEventById(id);
    if (event) event.deleteEvent(); // Null if it was already deleted by hand.
  }
}

// The most that fit on one line in Apple Calendar's event details on iPhone.
const RULE = '─'.repeat(19);

/**
 * An event's description: what it came from, then the contact, disclaimer and AI notice.
 *
 * @param {StudioCalendar} calendar
 * @param {string} source what the event came from, with a link to it
 * @param {string} check the sentence telling people where to confirm the event
 * @returns {string}
 */
function eventDescription_(calendar, source, check) {
  return [
    source,
    RULE,
    shareSection_(calendar),
    RULE,
    CONFIG.DISCLAIMER,
    `${CONFIG.AI_NOTICE} ${check}`,
  ].join('\n\n');
}

/**
 * @param {StudioCalendar} calendar
 * @returns {string}
 */
function shareSection_(calendar) {
  return `${CONFIG.CONTACT}\n\nShare this calendar:\n${subscribeUrl_(calendar)}`;
}

/** @type {Record<string, StudioCalendar>} */
const calendarCache_ = {};

/**
 * The calendar's public iCal feed as a webcal:// link, which opens a subscribe prompt.
 *
 * @param {StudioCalendar} calendar
 * @returns {string}
 */
function subscribeUrl_(calendar) {
  return `webcal://calendar.google.com/calendar/ical/${encodeURIComponent(calendar.getId())}/public/basic.ics`;
}

/**
 * @param {string} name
 * @param {string} sheetUrl
 * @returns {StudioCalendar}
 */
function getCalendar_(name, sheetUrl) {
  if (!calendarCache_[name]) {
    const calendar =
      CalendarApp.getCalendarsByName(name)[0] ||
      CalendarApp.createCalendar(name);
    const description = [
      shareSection_(calendar),
      RULE,
      CONFIG.DISCLAIMER,
      `${CONFIG.AI_NOTICE} Check the kiln notes before relying on an event:\n${sheetUrl}`,
    ].join('\n\n');
    if (calendar.getDescription() !== description)
      calendar.setDescription(description);
    calendarCache_[name] = calendar;
  }
  return calendarCache_[name];
}
