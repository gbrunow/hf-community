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
 *        GEMINI_MODEL           replaces CONFIG.DEFAULT_GEMINI_MODEL when Google retires a model.
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

function sync() {
  reconcileTrigger_();
  run_({ dryRun: false, pastDays: CONFIG.WINDOW_PAST_DAYS });
}

function forceSync() {
  reset();
  sync();
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
  const props = PropertiesService.getScriptProperties();
  let events = 0;
  for (const source of sources_()) {
    for (const [key, entry] of Object.entries(
      loadState_(props, source.statePrefix),
    )) {
      deleteEvents_(entry);
      events += entry.ids.length;
      props.deleteProperty(source.statePrefix + key);
    }
  }
  console.log(`Reset: deleted ${events} event(s). Run sync() to rebuild.`);
}
