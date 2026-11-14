// Shapes shared across src/*.js. Type-checking only: clasp pushes src/, not this file.

interface Studio {
  enabled: boolean;
  /** The column header in the kiln tab. */
  header: string;
  /** Matches the name of the tab holding this studio's discard schedule. */
  discardTab: RegExp;
  /** Matches the name of the events tab (the year is matched separately); absent when the studio has none. */
  eventsTab?: RegExp;
  /** The calendar for this studio's class sessions; absent when it has none. */
  classesCalendarName?: string;
  calendarName: string;
  location: string;
}

/** How events whose title matches are shown: an emoji in front of the title and/or a label color. */
interface EventStyle {
  name: string;
  pattern: RegExp;
  /** The legacy event color ID that owns this style's label. */
  colorId?: number;
  emoji?: string;
}

/** One studio's note on one day, as read from a row of the kiln tab. */
interface RowCell {
  studio: Studio;
  date: Date;
  /** The date as the sheet shows it, e.g. "Fri, Oct 9". */
  dateLabel: string;
  text: string;
  /** The whole row, e.g. "A7:E7". */
  rowRange: string;
}

interface Cell extends RowCell {
  sheetUrl: string;
  /** Opens the sheet with the cell's row selected. */
  rowUrl: string;
}

interface TimedItem {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, 24-hour */
  time: string;
}

interface Parsed {
  activities: string[];
  timed: TimedItem[];
}

/** One thing Gemini found in a note, before validation; an event with a time is timed. */
interface RawEvent {
  title?: unknown;
  date?: string;
  time?: string;
}

/** What Gemini returns for one note, before validation. */
interface RawParsed {
  events?: RawEvent[];
}

/** What the script remembers about a synced cell. */
interface SyncedEntry {
  calendarName: string;
  /** YYYY-MM-DD; null for items that belong to no single day. */
  date: string | null;
  ids: string[];
}

type StudioCalendar = GoogleAppsScript.Calendar.Calendar;
type CalendarEventHandle = GoogleAppsScript.Calendar.CalendarEvent;
type ScriptProperties = GoogleAppsScript.Properties.Properties;
type SheetTab = GoogleAppsScript.Spreadsheet.Sheet;

/** The part of the calendar a sync run covers. */
interface SyncWindow {
  today: Date;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * One unit a source syncs: a studio's note for a day, or a whole tab. Its key changes
 * when its content does, so a changed item is a new item and the old one disappears.
 */
interface Item<T> {
  key: string;
  /** The day it belongs to, deciding when it ages out of the window; null for items that belong to no single day. */
  date: Date | null;
  calendarName: string;
  /** The sheet URL linked from the calendar's description. */
  sheetUrl: string;
  /** Identifies the item in logs. */
  label: string;
  payload: T;
}

/** A sheet tab (or part of one) that becomes calendar events. T is a payload, R a parse result. */
interface Source<T, R> {
  name: string;
  /** Prefix of this source's entries in the script properties. */
  statePrefix: string;
  /** Days ahead this source covers; the global SYNC_MAX_DAYS_AHEAD when absent. */
  lookaheadDays?: number;
  /** Whether parse calls Gemini, so the run summary names the model. */
  usesModel?: boolean;
  /** Most items sent to parse at once; CONFIG.MAX_NOTES_PER_REQUEST when absent. */
  maxItemsPerRequest?: number;
  /** Reads the items inside the window, which already reflects lookaheadDays. */
  read(window: SyncWindow): Item<T>[];
  /** One result per payload, in order; undefined for a payload that could not be parsed. */
  parse(payloads: T[], model: string): (R | undefined)[];
  /** Creates the events and returns their IDs. */
  createEvents(calendar: StudioCalendar, payload: T, result: R): string[];
  describe(result: R): string;
  countEvents(result: R): number;
}

/** A studio's discard schedule tab, as read for parsing. */
interface DiscardTab {
  studio: Studio;
  tabName: string;
  /** Opens the sheet on this tab. */
  tabUrl: string;
  /** One row per line, the cells of a row joined with " | ". */
  text: string;
  /** Resolves the years the schedule leaves out. */
  today: Date;
}

/** A date as the schedule writes it; the year only when it writes one. */
interface RawDiscardDate {
  month?: number;
  day?: number;
  year?: number;
}

/** What Gemini returns for a discard schedule, before the dates are resolved. */
interface RawDiscard {
  groups?: { workType?: string; dates?: RawDiscardDate[] }[];
}

interface DiscardResult {
  /** All-day events, soonest first; date is YYYY-MM-DD. */
  events: { date: string; title: string }[];
}

/** One row of a studio's events tab, or one side-table entry, before Gemini reads it. */
interface EventsRecord {
  /** A class session (the row has an event name), an announcement (it doesn't), or a side-table entry. */
  kind: 'schedule' | 'announcement' | 'side';
  date: Date;
  /** The date as the sheet shows it, e.g. "Wed, Jan 7". */
  dateLabel: string;
  rowNumber: number;
  /** The row's non-empty cells keyed by the column headers (or "Side table"). */
  fields: Record<string, string>;
  /** Opens the sheet with this row selected. */
  url: string;
}

/** What a source of events-tab rows sends to Gemini and later turns into events: one day's records. */
interface EventsPayload {
  studio: Studio;
  /** Where the events go. */
  kind: 'classes' | 'closures';
  /** YYYY-MM-DD */
  iso: string;
  dateLabel: string;
  records: EventsRecord[];
}

/** What Gemini returns for one event of an events-tab day, before validation. */
interface RawDayEvent {
  title?: unknown;
  start?: string;
  end?: string;
  wheels?: string;
  handBuilding?: string;
}

interface DayEvent {
  title: string;
  /** HH:MM, with end; both absent for an all-day event. */
  start?: string;
  end?: string;
  /** The cells as written, verified against the row; empty when the event has none. */
  wheels: string;
  handBuilding: string;
}

interface EventsResult {
  events: DayEvent[];
}

/** An event found on one of the studios' calendars. */
interface ScannedEvent {
  calendarName: string;
  calendar: StudioCalendar;
  event: CalendarEventHandle;
}
