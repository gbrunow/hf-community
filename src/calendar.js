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
  return [source, disclaimers_(calendar), `${CONFIG.AI_NOTICE} ${check}`].join('\n\n');
}

/**
 * What every event on these calendars says about where it comes from, apart from the AI
 * notice: the contact, the share link and the unofficial-calendar disclaimer.
 *
 * @param {StudioCalendar} calendar
 * @returns {string}
 */
function disclaimers_(calendar) {
  return [RULE, shareSection_(calendar), RULE, CONFIG.DISCLAIMER].join('\n\n');
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

/**
 * Whether the script made this event: its description carries the AI notice, which only the
 * script's events say (hand-made ones get the other disclaimers, never that one). Cleanup
 * and reporting use this on top of the stored event IDs, which are the real record of what
 * the script owns. A text match errs toward leaving an event alone: if the wording changes,
 * older events stop matching rather than a hand-made one starting to.
 *
 * @param {CalendarEventHandle} event
 * @returns {boolean}
 */
function isScriptEvent_(event) {
  const description = event.getDescription();
  return description.includes(CONFIG.DISCLAIMER) && description.includes(CONFIG.AI_NOTICE);
}

/**
 * Sorts the events on the studios' calendars, across the sync window, into those the script
 * made and some stored item owns, those it made that none owns (leftovers of a failed run, or
 * copies from overlapping ones), and those made by hand.
 *
 * @returns {{ untracked: ScannedEvent[], tracked: number, manual: ScannedEvent[], missing: string[] }}
 */
function scanCalendars_() {
  const props = PropertiesService.getScriptProperties();
  /** @type {Set<string>} */
  const owned = new Set();
  for (const source of sources_()) {
    for (const entry of Object.values(loadState_(props, source.statePrefix))) {
      for (const id of entry.ids) owned.add(id);
    }
  }
  const today = startOfDay_(new Date());
  const from = addDays_(today, -CONFIG.WINDOW_PAST_DAYS);
  const to = addDays_(today, CONFIG.EVENTS_LOOKAHEAD_DAYS + 1);
  const names = CONFIG.STUDIOS.filter((s) => s.enabled).flatMap((s) =>
    s.classesCalendarName ? [s.calendarName, s.classesCalendarName] : [s.calendarName],
  );
  /** @type {{ untracked: ScannedEvent[], tracked: number, manual: ScannedEvent[], missing: string[] }} */
  const scan = { untracked: [], tracked: 0, manual: [], missing: [] };
  for (const name of names) {
    const calendar = CalendarApp.getCalendarsByName(name)[0];
    if (!calendar) {
      scan.missing.push(name);
      continue;
    }
    for (const event of calendar.getEvents(from, to)) {
      if (owned.has(event.getId())) scan.tracked++;
      else if (isScriptEvent_(event)) scan.untracked.push({ calendarName: name, calendar, event });
      else scan.manual.push({ calendarName: name, calendar, event });
    }
  }
  return scan;
}

/**
 * Adds the disclaimers (not the AI notice) below the text of the hand-made events in the sync
 * window that don't have them yet, so anyone seeing a hand-made event on these calendars
 * knows they are unofficial too. Events with guests are skipped, as editing them might
 * notify the guests. Returns how many it changed (or would change, for a dry run).
 *
 * @param {{ dryRun: boolean, outOfTime: () => boolean }} options
 * @returns {number}
 */
function annotateManualEvents_({ dryRun, outOfTime }) {
  let changed = 0;
  for (const { calendar, event } of scanCalendars_().manual) {
    if (outOfTime()) break;
    const text = event.getDescription();
    if (text.includes(CONFIG.DISCLAIMER) || event.getGuestList().length) continue;
    changed++;
    console.log(
      `${dryRun ? 'Would add' : 'Adding'} the disclaimers to the hand-made event "${event.getTitle()}".`,
    );
    if (dryRun) continue;
    const footer = text
      ? [text, disclaimers_(calendar)]
      : [shareSection_(calendar), RULE, CONFIG.DISCLAIMER];
    event.setDescription(footer.join('\n\n'));
  }
  return changed;
}
