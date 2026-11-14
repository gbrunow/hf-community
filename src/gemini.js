const SYSTEM_PROMPT = `You read notes from a pottery studio's kiln log. Each note describes what
the kilns are doing on one day at one studio. The user message is a JSON list of notes, each
with an "id", its "date" and "weekday", and the "note" text. Reply with {"results": [...]}
holding exactly one result per note, with the note's "id" and its "events": one event for
each thing happening in the studio, in the order the note gives them. A kiln activity
(loading, firing, cooling, unloading), a closure and an announcement each count. List each
thing once. Each event has:

- "title": a short label. Fix obvious typos and casing, and spell out kiln names:
  Redux/Rdx/Red → Reduction, Ox/Oxy → Oxidation, Bisq/Bisk → Bisque, E bisque → Electric
  bisque, Unldd → unloaded. Keep qualifiers and vague timing ("for Alex's class",
  "possibly in the afternoon"). Never add information.
- "date": YYYY-MM-DD. Use the note's date unless the note names another date; "10/10"
  means October 10 of the nearest year.
- "time": HH:MM, 24-hour, only for a thing that has a clock time. Approximate times count
  ("~4pm", "6 ish", "around 5pm", "by 2pm"). An hour without am/pm falls within studio
  hours, 09:00-21:59, so "6 ish" is 18:00. Leave "time" out for everything else. Vague
  timing ("in PM", "later", "possible unload") is not a clock time: keep that wording in
  the title.

Examples, note → result:
{"id":0,"date":"2026-10-09","weekday":"Fri","note":"Bisque Loading, reduction cooling (unload 10/10 by 11am)"}
→ {"id":0,"events":[{"title":"Bisque loading","date":"2026-10-09"},{"title":"Reduction cooling","date":"2026-10-09"},{"title":"Reduction unload","date":"2026-10-10","time":"11:00"}]}
{"id":1,"date":"2026-06-05","weekday":"Fri","note":"Reduction late unload (by 6 ish), bisque loading"}
→ {"id":1,"events":[{"title":"Reduction unload (late)","date":"2026-06-05","time":"18:00"},{"title":"Bisque loading","date":"2026-06-05"}]}
{"id":2,"date":"2026-10-10","weekday":"Sat","note":"reduction to be cooled, possible unload in PM"}
→ {"id":2,"events":[{"title":"Reduction cooling","date":"2026-10-10"},{"title":"Reduction possibly unloaded in the afternoon","date":"2026-10-10"}]}
{"id":3,"date":"2026-10-02","weekday":"Fri","note":"Reduction unloaded, Bisque loading, Lowfire bisque for Alex's class loaded"}
→ {"id":3,"events":[{"title":"Reduction unloaded","date":"2026-10-02"},{"title":"Bisque loading","date":"2026-10-02"},{"title":"Lowfire bisque loaded (Alex's class)","date":"2026-10-02"}]}
{"id":4,"date":"2026-11-15","weekday":"Sun","note":"Bisq o be unloaded~2pm"}
→ {"id":4,"events":[{"title":"Bisque unload","date":"2026-11-15","time":"14:00"}]}`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER' },
          events: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                title: { type: 'STRING' },
                date: { type: 'STRING' },
                time: { type: 'STRING' },
              },
              required: ['title', 'date'],
            },
          },
        },
        required: ['id', 'events'],
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
 * Splits Gemini's events into all-day activities and timed items, dropping timed items
 * the model got malformed or placed implausibly far from the row, and falls back to the
 * raw note when nothing usable is left.
 *
 * @param {RawParsed} parsed
 * @param {Cell} cell
 * @returns {Parsed}
 */
function validateParsed_(parsed, cell) {
  /** @type {string[]} */
  const activities = [];
  /** @type {TimedItem[]} */
  const timed = [];
  for (const event of parsed.events || []) {
    const title = String(event.title ?? '').trim();
    if (!title) continue;
    if (!event.time) {
      activities.push(title);
      continue;
    }
    const { date, time } = event;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    ) {
      continue;
    }
    const daysAway =
      Math.abs(parseIsoDate_(date ?? '').getTime() - cell.date.getTime()) /
      86400000;
    if (daysAway <= 7) timed.push({ title, date: date ?? '', time });
  }
  if (!activities.length && !timed.length) activities.push(cell.text);
  return { activities, timed };
}
