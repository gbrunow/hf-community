const SYSTEM_PROMPT = `You read notes from a pottery studio's kiln log. Each note describes what
the kilns are doing on one day at one studio. The user message is a JSON list of notes, each
with an "id", its "date" and "weekday", and the "note" text. Reply with {"results": [...]}
holding exactly one result per note, with the note's "id" and:

- "activities": one short label per kiln activity or announcement in the note, in order,
  each of which becomes its own calendar event. Fix obvious typos and casing, and spell
  out kiln names: Redux/Rdx/Red → Reduction, Ox/Oxy → Oxidation, Bisq/Bisk → Bisque,
  E bisque → Electric bisque, Unldd → unloaded. Keep qualifiers and vague timing
  ("for Alex's class", "possibly in the afternoon"). Leave out anything you moved into
  "timed". Never add information.
- "timed": one item per thing that happens at a specific clock time. Approximate times
  count ("~4pm", "6 ish", "around 5pm"). Each item has:
  - "title": a short label such as "Bisque unload".
  - "date": YYYY-MM-DD. Use the note's date unless the note names another date; "10/10"
    means October 10 of the nearest year.
  - "time": HH:MM, 24-hour. An hour without am/pm falls within studio hours, 09:00-21:59,
    so "6 ish" is 18:00.
  Vague timing ("in PM", "later", "possible unload") is not a timed item. Use an empty
  list when there are none.

Examples, note → result:
{"id":0,"date":"2026-10-09","weekday":"Fri","note":"Bisque Loading, reduction cooling (unload 10/10 by 11am)"}
→ {"id":0,"activities":["Bisque loading","Reduction cooling"],"timed":[{"title":"Reduction unload","date":"2026-10-10","time":"11:00"}]}
{"id":1,"date":"2026-06-05","weekday":"Fri","note":"Reduction late unload (by 6 ish), bisque loading"}
→ {"id":1,"activities":["Bisque loading"],"timed":[{"title":"Reduction unload (late)","date":"2026-06-05","time":"18:00"}]}
{"id":2,"date":"2026-10-10","weekday":"Sat","note":"reduction to be cooled, possible unload in PM"}
→ {"id":2,"activities":["Reduction cooling","Reduction possibly unloaded in the afternoon"],"timed":[]}
{"id":3,"date":"2026-10-02","weekday":"Fri","note":"Reduction unloaded, Bisque loading, Lowfire bisque for Alex's class loaded"}
→ {"id":3,"activities":["Reduction unloaded","Bisque loading","Lowfire bisque loaded (Alex's class)"],"timed":[]}`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER' },
          activities: { type: 'ARRAY', items: { type: 'STRING' } },
          timed: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                title: { type: 'STRING' },
                date: { type: 'STRING' },
                time: { type: 'STRING' },
              },
              required: ['title', 'date', 'time'],
            },
          },
        },
        required: ['id', 'activities', 'timed'],
      },
    },
  },
  required: ['results'],
};

/**
 * @param {boolean} forPreview
 * @returns {string}
 */
function geminiModel_(forPreview) {
  const props = PropertiesService.getScriptProperties();
  return (
    (forPreview && props.getProperty('GEMINI_PREVIEW_MODEL')) ||
    props.getProperty('GEMINI_MODEL') ||
    CONFIG.DEFAULT_GEMINI_MODEL
  );
}

/**
 * Parses a batch of notes in one Gemini request. Returns results indexed like `cells`;
 * a note missing from the reply is left undefined.
 *
 * @param {Cell[]} cells
 * @param {string} model
 * @returns {(Parsed | undefined)[]}
 */
function parseNotes_(cells, model) {
  const apiKey = requiredProperty_('GEMINI_API_KEY');
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const notes = cells.map((cell, id) => ({
    id,
    date: isoDate_(cell.date),
    weekday: weekdays[cell.date.getDay()],
    note: cell.text,
  }));
  const thinkingLevel =
    PropertiesService.getScriptProperties().getProperty(
      'GEMINI_THINKING_LEVEL',
    ) || CONFIG.DEFAULT_GEMINI_THINKING_LEVEL;
  /** @type {Record<string, unknown>} */
  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
  };
  if (thinkingLevel !== 'default') {
    generationConfig.thinkingConfig = { thinkingLevel };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  /** @type {GoogleAppsScript.URL_Fetch.URLFetchRequestOptions} */
  const request = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(notes) }] }],
      generationConfig,
    }),
  };

  let response;
  for (let attempt = 1; ; attempt++) {
    response = UrlFetchApp.fetch(url, request);
    const code = response.getResponseCode();
    // Only server errors are retried. A 429 means the quota is spent, which waiting
    // seconds won't fix, and the next scheduled run retries anyway.
    if (code < 500 || attempt === 3) break;
    console.warn(
      `Gemini HTTP ${code} on attempt ${attempt}; retrying in ${10 * attempt}s`,
    );
    Utilities.sleep(10000 * attempt);
  }
  if (response.getResponseCode() !== 200) {
    throw new Error(
      `Gemini HTTP ${response.getResponseCode()}: ${response.getContentText().slice(0, 300)}`,
    );
  }

  /** @type {{ candidates: { content: { parts: { text: string, thought?: boolean }[] } }[] }} */
  const body = JSON.parse(response.getContentText());
  // Skip thought parts, which some models return alongside the answer.
  const text = body.candidates[0].content.parts
    .filter((part) => !part.thought)
    .map((part) => part.text)
    .join('');
  /** @type {(Parsed | undefined)[]} */
  const results = [];
  for (const result of JSON.parse(text).results || []) {
    const cell = cells[result.id];
    if (cell && !results[result.id]) {
      results[result.id] = validateParsed_(result, cell);
    }
  }
  return results;
}

/**
 * Drops timed items the model got malformed or placed implausibly far from the row, and
 * falls back to the raw note when nothing usable is left.
 *
 * @param {RawParsed} parsed
 * @param {Cell} cell
 * @returns {Parsed}
 */
function validateParsed_(parsed, cell) {
  const activities = (parsed.activities || [])
    .map((activity) => String(activity).trim())
    .filter(Boolean);
  const timed = (parsed.timed || []).filter((item) => {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)
    ) {
      return false;
    }
    const daysAway =
      Math.abs(parseIsoDate_(item.date).getTime() - cell.date.getTime()) / 86400000;
    return daysAway <= 7;
  });
  if (!activities.length && !timed.length) activities.push(cell.text);
  return { activities, timed };
}
