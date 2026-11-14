/**
 * @typedef {Object} SyncContext
 * @property {ScriptProperties} props
 * @property {boolean} dryRun
 * @property {{ cells: number, unchanged: number, added: number, events: number, removed: number, failed: number, deferred: number }} counts
 * @property {() => boolean} outOfTime
 * @property {string} model
 * @property {boolean} modelUsed whether a source that calls Gemini had anything to parse
 */

/**
 * @param {{ dryRun: boolean, pastDays: number, ignoreState?: boolean }} options ignoreState
 *   treats every item as new, to see what a full re-parse would produce; only with dryRun.
 */
function run_({ dryRun, pastDays, ignoreState = false }) {
  if (ignoreState && !dryRun) throw new Error('ignoreState needs dryRun');
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > CONFIG.RUN_TIME_BUDGET_MS;
  const today = startOfDay_(new Date());
  const windowStart = addDays_(today, -pastDays);
  const windowEnd = addDays_(today, syncMaxDaysAhead_());

  const props = PropertiesService.getScriptProperties();
  const counts = {
    cells: 0,
    unchanged: 0,
    added: 0,
    events: 0,
    removed: 0,
    failed: 0,
    deferred: 0,
  };
  /** @type {SyncContext} */
  const context = {
    props,
    dryRun,
    counts,
    outOfTime,
    model: geminiModel_(dryRun),
    modelUsed: false,
  };

  // Every source is read before anything is written, so a source that can't be read
  // (say, a missing tab) fails the run instead of looking like every item was cleared.
  const runs = sources_().map((source) => {
    const window = {
      today,
      windowStart,
      windowEnd:
        source.lookaheadDays === undefined
          ? windowEnd
          : addDays_(today, source.lookaheadDays),
    };
    const state = ignoreState ? {} : loadState_(props, source.statePrefix);
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {Item<any>[]} */
    const fresh = [];
    for (const item of source.read(window)) {
      counts.cells++;
      seen.add(item.key);
      if (state[item.key]) {
        counts.unchanged++;
      } else {
        fresh.push(item);
      }
    }
    return { source, state, seen, fresh, window };
  });

  let timedOut = false;
  for (const run of runs) {
    if (timedOut) {
      counts.deferred += run.fresh.length;
    } else {
      timedOut = createFresh_(run, context);
    }
  }
  for (const run of runs) {
    removeVanished_(run, context);
  }

  console.log(
    `${dryRun ? 'Preview' : 'Sync'} of ${isoDate_(windowStart)} to ${isoDate_(windowEnd)}: ` +
      `${counts.cells} items, ${counts.unchanged} unchanged, ${counts.added} new ` +
      `(${counts.events} events ${dryRun ? 'to add' : 'added'}), ` +
      `${counts.removed} events ${dryRun ? 'to remove' : 'removed'}, ${counts.failed} failed` +
      (counts.deferred
        ? `, ${counts.deferred} left for the next run (out of time).`
        : '.') +
      (context.modelUsed ? ` Model: ${context.model}.` : ''),
  );
}

/**
 * Parses a source's new items in batches and creates their events. Returns whether the
 * run ran out of time.
 *
 * @param {{ source: Source<any, any>, fresh: Item<any>[] }} run
 * @param {SyncContext} context
 * @returns {boolean}
 */
function createFresh_({ source, fresh }, context) {
  const { props, dryRun, counts, outOfTime, model } = context;
  if (source.usesModel && fresh.length) context.modelUsed = true;
  const batchSize = Math.ceil(
    fresh.length / Math.ceil(fresh.length / CONFIG.MAX_NOTES_PER_REQUEST),
  );
  for (let start = 0; start < fresh.length; start += batchSize) {
    if (outOfTime()) {
      counts.deferred += fresh.length - start;
      return true;
    }
    const batch = fresh.slice(start, start + batchSize);
    /** @type {unknown[]} */
    let results;
    try {
      results = source.parse(
        batch.map((item) => item.payload),
        model,
      );
    } catch (e) {
      // Later batches would most likely hit the same error (usually a rate limit), so
      // leave everything left for the next run.
      console.error(
        `Skipping ${fresh.length - start} ${source.name} item(s) until the next run: ${e instanceof Error ? e.message : e}`,
      );
      counts.failed += fresh.length - start;
      return false;
    }

    for (const [id, item] of batch.entries()) {
      if (outOfTime()) {
        counts.deferred += fresh.length - (start + id);
        return true;
      }
      const parsed = results[id];
      if (!parsed) {
        console.error(`Skipping ${item.label}: missing from Gemini's reply`);
        counts.failed++;
        continue;
      }

      counts.added++;
      counts.events += source.countEvents(parsed);
      console.log(
        `${dryRun ? 'Would add' : 'Added'} ${item.label}\n  → ${source.describe(parsed)}`,
      );
      if (dryRun) continue;

      const ids = source.createEvents(
        getCalendar_(item.calendarName, item.sheetUrl),
        item.payload,
        parsed,
      );
      props.setProperty(
        source.statePrefix + item.key,
        JSON.stringify({
          calendarName: item.calendarName,
          date: item.date ? isoDate_(item.date) : null,
          ids,
        }),
      );
    }
  }
  return false;
}

/**
 * Removes the events of items that are no longer in the source: edited or cleared
 * (inside the window), or aged out of it (forgotten, their events kept). Items without a
 * date are never in the window or out of it, so they are removed whenever they vanish.
 *
 * @param {{ source: Source<any, any>, state: Record<string, SyncedEntry>, seen: Set<string>, window: SyncWindow }} run
 * @param {SyncContext} context
 */
function removeVanished_({ source, state, seen, window }, context) {
  const { props, dryRun, counts } = context;
  const { windowStart, windowEnd } = window;
  for (const [key, entry] of Object.entries(state)) {
    if (seen.has(key)) continue;
    if (entry.date) {
      const date = parseIsoDate_(entry.date);
      if (date < windowStart) {
        // Aged out of the window: keep its events, forget the item.
        if (!dryRun) props.deleteProperty(source.statePrefix + key);
        continue;
      }
      if (date > windowEnd) continue;
    }

    counts.removed += entry.ids.length;
    console.log(
      `${dryRun ? 'Would remove' : 'Removed'} ${entry.ids.length} event(s) for ${entry.calendarName} ${entry.date ?? source.name}`,
    );
    if (dryRun) continue;
    deleteEvents_(entry);
    props.deleteProperty(source.statePrefix + key);
  }
}

/**
 * "Bisque loading [Loading] · 2026-10-10 11:00 Reduction unload [Unloaded]"
 *
 * @param {Parsed} parsed
 * @returns {string}
 */
function describeParsed_(parsed) {
  /** @param {string} title */
  const label = (title) => `${title} [${stageOf_(title)?.name || 'no stage'}]`;
  return [
    ...parsed.activities.map(label),
    ...parsed.timed.map(
      (item) => `${item.date} ${item.time} ${label(item.title)}`,
    ),
  ].join(' · ');
}

/**
 * @param {ScriptProperties} props
 * @param {string} prefix
 * @returns {Record<string, SyncedEntry>}
 */
function loadState_(props, prefix) {
  /** @type {Record<string, SyncedEntry>} */
  const state = {};
  for (const [name, value] of Object.entries(props.getProperties())) {
    if (name.startsWith(prefix))
      state[name.slice(prefix.length)] = JSON.parse(value);
  }
  return state;
}

/**
 * @param {Pick<RowCell, 'studio' | 'date' | 'text'>} cell
 * @returns {string}
 */
function cellKey_(cell) {
  return hashKey_([cell.studio.header, isoDate_(cell.date), cell.text]);
}

/**
 * A short key that changes whenever any of the parts do.
 *
 * @param {string[]} parts
 * @returns {string}
 */
function hashKey_(parts) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    parts.join('\u0000'),
    Utilities.Charset.UTF_8,
  );
  return Utilities.base64EncodeWebSafe(digest).slice(0, 22);
}

/**
 * @param {Pick<RowCell, 'studio' | 'date' | 'text'>} cell
 * @returns {string}
 */
function describe_(cell) {
  return `${cell.studio.header} ${isoDate_(cell.date)} "${cell.text}"`;
}
