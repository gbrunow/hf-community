/**
 * Syncs the studio kiln log (a Google Sheet) into one Google Calendar per studio.
 *
 * Every non-empty studio cell becomes one all-day event per kiln activity it mentions
 * ("Reduction unloaded", "Bisque loading"). Anything at a clock time ("unload by ~4pm",
 * "unload 10/10 by 11am") becomes a timed event instead.
 * Gemini parses the free-form notes; each cell is parsed once and remembered by a hash
 * of its content, so an edited cell has its events replaced and a cleared cell has
 * them removed.
 *
 * Setup:
 *   1. Project Settings → Script properties → add SOURCE_SPREADSHEET_ID (the long id in
 *      the source sheet's URL) and GEMINI_API_KEY. Kept out of the code so pasting in a
 *      new version doesn't wipe them. Optional overrides:
 *        GEMINI_MODEL           replaces CONFIG.DEFAULT_GEMINI_MODEL, e.g. to pin one model.
 *        SYNC_INTERVAL_MINUTES  replaces CONFIG.DEFAULT_SYNC_INTERVAL_MINUTES; sync() picks
 *                               up a change on its next run.
 *        SYNC_MAX_DAYS_AHEAD    replaces CONFIG.DEFAULT_SYNC_MAX_DAYS_AHEAD.
 *        GEMINI_THINKING_LEVEL  replaces CONFIG.DEFAULT_GEMINI_THINKING_LEVEL; "default"
 *                               omits the setting, for models that don't accept it.
 *        GEMINI_PREVIEW_MODEL   used by preview() instead of the sync model, to try a
 *                               model out before switching GEMINI_MODEL to it.
 *   2. Project Settings → set the time zone to the studio's.
 *   3. Run preview() and check the log. Nothing is written.
 *   4. Run sync() once, then installTrigger().
 */

// The interval the current trigger was installed with; Apps Script can't report it.
const INSTALLED_INTERVAL_PROPERTY = 'trigger:intervalMinutes';

// The only intervals Apps Script time-based triggers support.
const ALLOWED_INTERVAL_MINUTES = [
  1, 5, 10, 15, 30, 60, 120, 240, 360, 480, 720,
];

/**
 * Logs what sync() would do, over a wider past window so there's more to look at.
 * Declared first so it's the editor's default Run target.
 */
function preview() {
  run_({ dryRun: true, pastDays: 14 });
}

/**
 * Like preview(), but parses every note again instead of skipping the ones already synced,
 * to see what a full re-parse would produce. Writes nothing.
 */
function previewAll() {
  run_({ dryRun: true, pastDays: 14, ignoreState: true });
}

function sync() {
  withLock_('sync', syncNow_);
}

function syncNow_() {
  reconcileTrigger_();
  run_({ dryRun: false, pastDays: CONFIG.WINDOW_PAST_DAYS });
}

function forceSync() {
  withLock_('forceSync', () => {
    resetAll_();
    syncNow_();
  });
}

function installTrigger() {
  const minutes = syncIntervalMinutes_();
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'sync')
      ScriptApp.deleteTrigger(trigger);
  }
  const builder = ScriptApp.newTrigger('sync').timeBased();
  (minutes < 60
    ? builder.everyMinutes(minutes)
    : builder.everyHours(minutes / 60)
  ).create();
  PropertiesService.getScriptProperties().setProperty(
    INSTALLED_INTERVAL_PROPERTY,
    String(minutes),
  );
  console.log(`Installed the sync trigger: every ${minutes} minutes.`);
}

/** Reinstalls the trigger when SYNC_INTERVAL_MINUTES no longer matches it. */
function reconcileTrigger_() {
  const hasTrigger = ScriptApp.getProjectTriggers().some(
    (trigger) => trigger.getHandlerFunction() === 'sync',
  );
  if (!hasTrigger) return; // Never installed: sync() is being run by hand.
  const installed = Number(
    PropertiesService.getScriptProperties().getProperty(
      INSTALLED_INTERVAL_PROPERTY,
    ),
  );
  if (installed !== syncIntervalMinutes_()) installTrigger();
}

function syncIntervalMinutes_() {
  const value = PropertiesService.getScriptProperties().getProperty(
    'SYNC_INTERVAL_MINUTES',
  );
  const minutes = value ? Number(value) : CONFIG.DEFAULT_SYNC_INTERVAL_MINUTES;
  if (!ALLOWED_INTERVAL_MINUTES.includes(minutes)) {
    throw new Error(
      `SYNC_INTERVAL_MINUTES is "${value}"; it must be one of ${ALLOWED_INTERVAL_MINUTES.join(', ')}`,
    );
  }
  return minutes;
}

function syncMaxDaysAhead_() {
  const value = PropertiesService.getScriptProperties().getProperty(
    'SYNC_MAX_DAYS_AHEAD',
  );
  const days = value ? Number(value) : CONFIG.DEFAULT_SYNC_MAX_DAYS_AHEAD;
  if (!Number.isInteger(days) || days < 0 || days > 366) {
    throw new Error(
      `SYNC_MAX_DAYS_AHEAD is "${value}"; it must be a whole number from 0 to 366`,
    );
  }
  return days;
}

/**
 * Deletes every event this script created and forgets every cell, so the next sync()
 * rebuilds from scratch. Use after renaming calendars or changing how events look.
 */
function reset() {
  withLock_('reset', resetAll_);
}

function resetAll_() {
  const props = PropertiesService.getScriptProperties();
  const events = sources_().reduce((sum, source) => sum + clearSource_(source, props), 0);
  console.log(`Reset: deleted ${events} event(s). Run sync() to rebuild.`);
}

/**
 * Like reset(), for one source: deletes the events it created and forgets its items, so the
 * next sync() rebuilds just those. Run it with `npm run fn -- resetSource -p '["classes"]'`.
 *
 * @param {string} name a source's name, such as "kiln", "discard", "classes" or "closures"
 */
function resetSource(name) {
  withLock_('resetSource', () => resetOne_(name));
}

/** @param {string} name */
function resetOne_(name) {
  const source = sources_().find((s) => s.name === name);
  if (!source) {
    throw new Error(
      `No source named "${name}"; the sources are ${sources_().map((s) => s.name).join(', ')}`,
    );
  }
  const events = clearSource_(source, PropertiesService.getScriptProperties());
  console.log(`Reset ${name}: deleted ${events} event(s). Run sync() to rebuild.`);
}

/**
 * Like resetSource("classes"), and also deletes the events on the classes calendars that no
 * state entry points to, such as the copies two overlapping runs once created. Those
 * calendars hold nothing but class sessions, so every event on them can go.
 */
function purgeClasses() {
  withLock_('purgeClasses', () => {
    const props = PropertiesService.getScriptProperties();
    const classes = sources_().find((source) => source.name === 'classes');
    let events = classes ? clearSource_(classes, props) : 0;
    const today = startOfDay_(new Date());
    for (const studio of CONFIG.STUDIOS) {
      const calendar = studio.classesCalendarName
        ? CalendarApp.getCalendarsByName(studio.classesCalendarName)[0]
        : undefined;
      if (!calendar) continue;
      for (const event of calendar.getEvents(addDays_(today, -60), addDays_(today, 400))) {
        event.deleteEvent();
        events++;
      }
    }
    console.log(`Purged the classes: deleted ${events} event(s). Run sync() to rebuild.`);
  });
}

/**
 * @param {Source<any, any>} source
 * @param {ScriptProperties} props
 * @returns {number} how many events were deleted
 */
function clearSource_(source, props) {
  let events = 0;
  for (const [key, entry] of Object.entries(loadState_(props, source.statePrefix))) {
    deleteEvents_(entry);
    events += entry.ids.length;
    props.deleteProperty(source.statePrefix + key);
  }
  return events;
}
