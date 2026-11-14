// Shapes shared across src/*.js. Type-checking only: clasp pushes src/, not this file.

interface Studio {
  enabled: boolean;
  /** The column header in the kiln tab. */
  header: string;
  calendarName: string;
  location: string;
}

interface Stage {
  name: string;
  pattern: RegExp;
  /** The legacy event color ID that owns this stage's label. */
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

/** What Gemini returns for one note, before validation. */
interface RawParsed {
  activities?: unknown[];
  timed?: TimedItem[];
}

/** What the script remembers about a synced cell. */
interface SyncedEntry {
  calendarName: string;
  /** YYYY-MM-DD */
  date: string;
  ids: string[];
}

type StudioCalendar = GoogleAppsScript.Calendar.Calendar;
type CalendarEventHandle = GoogleAppsScript.Calendar.CalendarEvent;
type ScriptProperties = GoogleAppsScript.Properties.Properties;
type SheetTab = GoogleAppsScript.Spreadsheet.Sheet;
