/**
 * Logs a one-tap webcal:// subscribe link for each enabled studio's calendar. The links
 * only work once the calendar is public (Settings → the calendar → Access permissions →
 * Make available to public); scripts can't read the private secret address.
 */
function subscribeLinks() {
  for (const studio of CONFIG.STUDIOS.filter((s) => s.enabled)) {
    const calendar = CalendarApp.getCalendarsByName(studio.calendarName)[0];
    if (!calendar) {
      console.log(`${studio.calendarName}: not created yet; run sync() first.`);
      continue;
    }
    const link = subscribeUrl_(calendar);
    // Fetched without your sign-in, so it only succeeds if the calendar is public.
    const feed = UrlFetchApp.fetch(link.replace(/^webcal:/, 'https:'), {
      muteHttpExceptions: true,
    });
    const isPublic =
      feed.getResponseCode() === 200 &&
      feed.getContentText().startsWith('BEGIN:VCALENDAR');
    console.log(
      `${studio.calendarName}: ${link}` +
        (isPublic
          ? ''
          : "\n  Not public yet, so this link won't work until it is."),
    );
  }
}

/**
 * Logs the text models this API key can call, for picking a GEMINI_MODEL value. Doesn't
 * count against the generation quota.
 */
function listModels() {
  const response = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    {
      headers: { 'x-goog-api-key': requiredProperty_('GEMINI_API_KEY') },
      muteHttpExceptions: true,
    },
  );
  if (response.getResponseCode() !== 200) {
    throw new Error(
      `Gemini HTTP ${response.getResponseCode()}: ${response.getContentText().slice(0, 300)}`,
    );
  }
  const lines = (JSON.parse(response.getContentText()).models || [])
    .filter((m) =>
      (m.supportedGenerationMethods || []).includes('generateContent'),
    )
    .map(
      (m) =>
        `${m.name.replace(/^models\//, '')} — ${m.displayName}` +
        (m.thinking ? ' (thinking)' : ''),
    );
  console.log(
    `${lines.length} models support generateContent:\n${lines.join('\n')}`,
  );
}

/** Logs the event color IDs the Calendar API accepts, with their hex, for CONFIG.STAGES. */
function listEventColors() {
  const response = UrlFetchApp.fetch(
    'https://www.googleapis.com/calendar/v3/colors',
    {
      headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
      muteHttpExceptions: true,
    },
  );
  if (response.getResponseCode() !== 200) {
    throw new Error(
      `Calendar HTTP ${response.getResponseCode()}: ${response.getContentText().slice(0, 300)}`,
    );
  }
  const colors = JSON.parse(response.getContentText()).event || {};
  const lines = Object.entries(colors).map(
    ([id, { background }]) => `${id.padStart(2)}  ${background}`,
  );
  console.log(`${lines.length} event colors (id, hex):\n${lines.join('\n')}`);
}

/**
 * Logs each upcoming event's colorId and any non-standard fields, to see how a label set
 * in the Google Calendar UI is stored. Needs the Google Calendar API advanced service.
 */
function inspectEventColors() {
  const standard = new Set([
    'kind',
    'etag',
    'id',
    'status',
    'htmlLink',
    'created',
    'updated',
    'summary',
    'description',
    'creator',
    'organizer',
    'start',
    'end',
    'iCalUID',
    'sequence',
    'reminders',
    'eventType',
    'colorId',
    'transparency',
    'visibility',
    'location',
    'attendees',
    'extendedProperties',
    'guestsCanInviteOthers',
    'privateCopy',
    'source',
    'recurringEventId',
    'originalStartTime',
    'endTimeUnspecified',
  ]);
  const today = startOfDay_(new Date());
  for (const studio of CONFIG.STUDIOS) {
    const calendar = CalendarApp.getCalendarsByName(studio.calendarName)[0];
    if (!calendar) continue;
    const { items = [] } = Calendar.Events.list(calendar.getId(), {
      timeMin: addDays_(today, -2).toISOString(),
      timeMax: addDays_(today, 14).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    const lines = items.map((item) => {
      const extra = Object.keys(item).filter((key) => !standard.has(key));
      const extras = extra.map((key) => `${key}=${JSON.stringify(item[key])}`);
      return `${item.start.date || item.start.dateTime}  colorId=${item.colorId || '-'}  ${item.summary}${extras.length ? `  ${extras.join(' ')}` : ''}`;
    });
    console.log(`${studio.calendarName}:\n${lines.join('\n')}`);
  }
}
