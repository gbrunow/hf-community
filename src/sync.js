const STATE_PREFIX = 'cell:';

function run_({ dryRun, pastDays }) {
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > CONFIG.RUN_TIME_BUDGET_MS;
  const today = startOfDay_(new Date());
  const windowStart = addDays_(today, -pastDays);
  const windowEnd = addDays_(today, syncMaxDaysAhead_());

  const props = PropertiesService.getScriptProperties();
  const state = loadState_(props);
  const seen = new Set();
  const counts = {
    cells: 0,
    unchanged: 0,
    added: 0,
    events: 0,
    removed: 0,
    failed: 0,
    deferred: 0,
  };

  const model = geminiModel_(dryRun);
  const fresh = [];
  for (const cell of readCells_(today, windowStart, windowEnd)) {
    counts.cells++;
    const key = cellKey_(cell);
    seen.add(key);
    if (state[key]) {
      counts.unchanged++;
    } else {
      fresh.push({ cell, key });
    }
  }

  const batchSize = Math.ceil(
    fresh.length / Math.ceil(fresh.length / CONFIG.MAX_NOTES_PER_REQUEST),
  );
  batches: for (let start = 0; start < fresh.length; start += batchSize) {
    if (outOfTime()) {
      counts.deferred += fresh.length - start;
      break;
    }
    const batch = fresh.slice(start, start + batchSize);
    let results;
    try {
      results = parseNotes_(
        batch.map(({ cell }) => cell),
        model,
      );
    } catch (e) {
      // Later batches would most likely hit the same error (usually a rate limit), so
      // leave everything left for the next run.
      console.error(
        `Skipping ${fresh.length - start} note(s) until the next run: ${e.message}`,
      );
      counts.failed += fresh.length - start;
      break;
    }

    for (const [id, { cell, key }] of batch.entries()) {
      if (outOfTime()) {
        counts.deferred += fresh.length - (start + id);
        break batches;
      }
      const parsed = results[id];
      if (!parsed) {
        console.error(
          `Skipping ${describe_(cell)}: missing from Gemini's reply`,
        );
        counts.failed++;
        continue;
      }

      counts.added++;
      counts.events += parsed.activities.length + parsed.timed.length;
      console.log(
        `${dryRun ? 'Would add' : 'Added'} ${describe_(cell)}\n  → ${describeParsed_(parsed)}`,
      );
      if (dryRun) continue;

      const ids = createEvents_(
        getCalendar_(cell.studio.calendarName, cell.sheetUrl),
        cell,
        parsed,
      );
      props.setProperty(
        STATE_PREFIX + key,
        JSON.stringify({
          calendarName: cell.studio.calendarName,
          date: isoDate_(cell.date),
          ids,
        }),
      );
    }
  }

  for (const [key, entry] of Object.entries(state)) {
    if (seen.has(key)) continue;
    const date = parseIsoDate_(entry.date);
    if (date < windowStart) {
      // Aged out of the window: keep its events, forget the cell.
      if (!dryRun) props.deleteProperty(STATE_PREFIX + key);
      continue;
    }
    if (date > windowEnd) continue;

    // Inside the window but no longer in the sheet: the cell was edited or cleared.
    counts.removed += entry.ids.length;
    console.log(
      `${dryRun ? 'Would remove' : 'Removed'} ${entry.ids.length} event(s) for ${entry.calendarName} ${entry.date}`,
    );
    if (dryRun) continue;
    deleteEvents_(entry);
    props.deleteProperty(STATE_PREFIX + key);
  }

  console.log(
    `${dryRun ? 'Preview' : 'Sync'} of ${isoDate_(windowStart)} to ${isoDate_(windowEnd)}: ` +
      `${counts.cells} cells, ${counts.unchanged} unchanged, ${counts.added} new ` +
      `(${counts.events} events ${dryRun ? 'to add' : 'added'}), ` +
      `${counts.removed} events ${dryRun ? 'to remove' : 'removed'}, ${counts.failed} failed` +
      (counts.deferred
        ? `, ${counts.deferred} left for the next run (out of time).`
        : '.') +
      (counts.added || counts.failed ? ` Model: ${model}.` : ''),
  );
}

/** "Bisque loading [Loading] · 2026-10-10 11:00 Reduction unload [Unloaded]" */
function describeParsed_(parsed) {
  const label = (title) => `${title} [${stageOf_(title)?.name || 'no stage'}]`;
  return [
    ...parsed.activities.map(label),
    ...parsed.timed.map(
      (item) => `${item.date} ${item.time} ${label(item.title)}`,
    ),
  ].join(' · ');
}

function loadState_(props) {
  const state = {};
  for (const [name, value] of Object.entries(props.getProperties())) {
    if (name.startsWith(STATE_PREFIX))
      state[name.slice(STATE_PREFIX.length)] = JSON.parse(value);
  }
  return state;
}

function cellKey_(cell) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    [cell.studio.header, isoDate_(cell.date), cell.text].join('\u0000'),
    Utilities.Charset.UTF_8,
  );
  return Utilities.base64EncodeWebSafe(digest).slice(0, 22);
}

function describe_(cell) {
  return `${cell.studio.header} ${isoDate_(cell.date)} "${cell.text}"`;
}
