const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const visibleText = html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

const KILN_ID = 'e3813f54da898922b6604a2218d0d7a1c9f6355394b6685841a7884cb99679b8%40group.calendar.google.com';
const CLASSES_ID = 'bc80c36710ad1db5c841dd224c413e6398b135a2e544226a2cf8a7aa3e718f00%40group.calendar.google.com';

test('the page has a viewport, a title and a description', () => {
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.match(html, /<title>Higher Fire Community Calendar<\/title>/);
  assert.match(html, /<meta name="description" content="Higher Fire community calendar with kiln schedule, discard days, and more\.">/);
});

test('every line of copy is on the page word for word', () => {
  const lines = [
    'Community calendar',
    "Higher Fire's kiln notes and classes , in your calendar",
    'Kiln notes & events',
    'Kiln stages from loading to unloading, discard days, closures and workshops.',
    'Classes',
    'See when classes run and how much space they take up in the studio.',
    'Subscribe with your calendar app',
    'Add to Google Calendar',
    'Copy link',
    'Another calendar app?',
    'In your app, add a calendar “From URL” and use the copied link.',
    'Disclaimer',
    "Not an official Higher Fire calendar. Events are generated from the studio's notes using AI, so mistakes can happen.",
    'Community calendar by Gui Brunow . Higher Fire Downtown only.',
    'Say hi',
    "It's just me on the other end",
  ];
  for (const line of lines) assert.ok(visibleText.includes(line), `missing: ${line}`);
});

test('each calendar has a webcal link, a Google add link and a copy link for the same calendar', () => {
  assert.doesNotMatch(html, /CLASSES_CALENDAR/, 'a placeholder is still in the page');
  const webcal = [...html.matchAll(/href="webcal:\/\/calendar\.google\.com\/calendar\/ical\/([^/"]+)\/public\/basic\.ics"/g)].map((m) => m[1]);
  const copy = [...html.matchAll(/data-copy="https:\/\/calendar\.google\.com\/calendar\/ical\/([^/"]+)\/public\/basic\.ics"/g)].map((m) => m[1]);
  const google = [...html.matchAll(/href="https:\/\/calendar\.google\.com\/calendar\/r\?cid=([^"]+)"/g)].map((m) => m[1]);
  assert.equal(webcal.length, 2);
  assert.deepEqual(copy, webcal);
  assert.equal(webcal[0], KILN_ID);
  assert.equal(webcal[1], CLASSES_ID);
  webcal.forEach((id, i) => {
    const calendarId = decodeURIComponent(id);
    assert.match(calendarId, /@group\.calendar\.google\.com$/);
    assert.equal(Buffer.from(google[i], 'base64').toString(), calendarId);
    assert.doesNotMatch(google[i], /=/, 'the cid carries no base64 padding');
  });
});

test("each card's buttons are labelled with their calendar, for screen readers", () => {
  for (const calendar of ['Kiln notes &amp; events', 'Classes']) {
    for (const label of [`Subscribe to ${calendar}`, `Add ${calendar} to Google Calendar`, `Copy the ${calendar} link`]) {
      assert.ok(html.includes(`aria-label="${label}"`), `missing label: ${label}`);
    }
  }
});

test('the contact capsule links to e-mail and to Instagram, which opens in a new tab', () => {
  assert.match(html, /<a href="mailto:gbrunow@outlook\.com\?subject=Hi%20from%20the%20Higher%20Fire%20calendar%20page" aria-label="E-mail Gui Brunow"/);
  assert.match(html, /<a href="https:\/\/instagram\.com\/gbrunow" target="_blank" rel="noopener noreferrer" aria-label="Instagram, gbrunow"/);
  assert.match(html, /Community calendar by <a href="mailto:gbrunow@outlook\.com"/);
});

test('analytics: the script tag has the website and the domain, and every link counts under its own name', () => {
  assert.match(html, /<script defer src="https:\/\/cloud\.umami\.is\/script\.js" data-website-id="d308e14e-3af8-47b5-8421-b3c96235007d" data-domains="gbrunow\.github\.io"><\/script>/);
  const names = [...html.matchAll(/data-umami-event="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, [
    'contact-email', 'contact-email-name', 'contact-instagram',
    'subscribe-classes-copy', 'subscribe-classes-google', 'subscribe-classes-webcal',
    'subscribe-kiln-copy', 'subscribe-kiln-google', 'subscribe-kiln-webcal',
  ]);
});

test('motion is switched off for visitors who ask for less, and the wide layout starts at 900px', () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /@media \(min-width: 900px\)/);
});

/** The page's own script, run without a document so only its helper functions are defined. */
function helpers() {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const code = scripts.find((s) => s.includes('function revealProgress'));
  const context = vm.createContext({});
  vm.runInContext(code, context);
  return context;
}

test('the reveal is 0 until the end of the page, then grows to 1 over the spare room', () => {
  const { revealProgress } = helpers();
  assert.equal(revealProgress(0, 1000, 700, 260), 0);
  assert.equal(revealProgress(300, 1000, 700, 260), 0, 'at the end of the page itself');
  assert.equal(revealProgress(430, 1000, 700, 260), 0.5);
  assert.equal(revealProgress(560, 1000, 700, 260), 1);
  assert.equal(revealProgress(900, 1000, 700, 260), 1, 'never past 1');
  assert.equal(revealProgress(26, 500, 700, 260), 0.1, 'a page shorter than the window starts the reveal at once');
  assert.equal(revealProgress(500, 500, 700, 0), 0, 'no spare room to scroll through');
});

test('the contact group shows on a downward scroll and hides on an upward one, unless the reveal lifted it', () => {
  const { contactVisible } = helpers();
  assert.equal(contactVisible(false, 100, 0, 0), true, 'scrolling down past 40px');
  assert.equal(contactVisible(false, 30, 0, 0), false, 'not yet 40px');
  assert.equal(contactVisible(true, 80, 100, 0), false, 'scrolling up');
  assert.equal(contactVisible(true, 80, 100, 0.3), true, 'scrolling up while lifted');
  assert.equal(contactVisible(true, 102, 100, 0), true, 'a small jitter changes nothing');
  assert.equal(contactVisible(false, 102, 100, 0), false, 'a small jitter does not show it either');
});

/**
 * The page's helpers with a stubbed clipboard and document; `execCommand` is what the selection fallback calls.
 * An `execResult` that is an Error is thrown. The document starts with a focused `button`; selecting the box moves focus to it.
 */
function copyHarness({ writeText, execResult }) {
  const context = helpers();
  const calls = { writeText: 0, execCommand: [], removed: 0, focused: [] };
  const document = {
    activeElement: null,
    body: { appendChild() {}, removeChild() { calls.removed += 1; } },
    createElement: () => {
      const box = { setAttribute() {}, style: {}, select() { document.activeElement = box; }, setSelectionRange() {} };
      return box;
    },
    execCommand: (command) => {
      calls.execCommand.push(command);
      if (execResult instanceof Error) throw execResult;
      return execResult;
    },
  };
  const button = { focus(options) { calls.focused.push(options); document.activeElement = button; } };
  document.activeElement = button;
  context.navigator = {
    clipboard: writeText && { writeText: (text) => { calls.writeText += 1; return writeText(text); } },
  };
  context.document = document;
  return { context, calls, button };
}

test('copying falls back to selecting the text when the Clipboard API rejects', async () => {
  const { context, calls } = copyHarness({ writeText: () => Promise.reject(new Error('denied')), execResult: true });
  await context.copyText('https://example.test/a.ics');
  assert.deepEqual(calls.execCommand, ['copy']);
  assert.equal(calls.removed, 1, 'the selection box is removed');
});

test('copying fails when the Clipboard API rejects and selecting the text fails too', async () => {
  const { context, calls } = copyHarness({ writeText: () => Promise.reject(new Error('denied')), execResult: false });
  await assert.rejects(context.copyText('https://example.test/a.ics'));
  assert.equal(calls.removed, 1, 'the selection box is removed');
});

test('copying fails and still removes the selection box when execCommand throws', async () => {
  const { context, calls } = copyHarness({ writeText: () => Promise.reject(new Error('denied')), execResult: new Error('blocked') });
  await assert.rejects(context.copyText('https://example.test/a.ics'), /blocked/);
  assert.equal(calls.removed, 1, 'the selection box is removed');
});

test('copying selects the text when there is no Clipboard API', async () => {
  const { context, calls } = copyHarness({ writeText: undefined, execResult: true });
  assert.equal(context.navigator.clipboard, undefined);
  await context.copyText('https://example.test/a.ics');
  assert.deepEqual(calls.execCommand, ['copy']);
  assert.equal(calls.removed, 1, 'the selection box is removed');
});

test('copying by selection returns focus to the element that had it', async () => {
  const { context, calls, button } = copyHarness({ writeText: undefined, execResult: true });
  await context.copyText('https://example.test/a.ics');
  assert.equal(calls.focused.length, 1);
  assert.equal(calls.focused[0].preventScroll, true, 'focusing does not scroll the page');
  assert.equal(context.document.activeElement, button);
});

test('copying uses only the Clipboard API when it works', async () => {
  const { context, calls } = copyHarness({ writeText: () => Promise.resolve(), execResult: true });
  await context.copyText('https://example.test/a.ics');
  assert.equal(calls.writeText, 1);
  assert.deepEqual(calls.execCommand, []);
});

/** WCAG relative luminance and contrast ratio for #rrggbb colors. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** The color of `ink` at `alpha` over `base`. */
function blend(ink, base, alpha) {
  const mix = (i) => Math.round(parseInt(ink.slice(i, i + 2), 16) * alpha + parseInt(base.slice(i, i + 2), 16) * (1 - alpha));
  return `#${[1, 3, 5].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`;
}

/** The value of a CSS custom property declared in :root. */
function cssVar(name) {
  const m = html.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(m, `--${name} is declared`);
  return m[1];
}
/** The alpha of the rgba(46,37,32,…) ink tint a rule's declaration uses. */
function inkAlpha(selector, property) {
  const rule = html.match(new RegExp(`${selector.replace(/[.*]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `${selector} has a rule`);
  const m = rule[1].match(new RegExp(`(?:^|;)\\s*${property}:\\s*rgba\\(46,\\s*37,\\s*32,\\s*([.\\d]+)\\)`));
  assert.ok(m, `${selector} sets ${property} to an ink tint`);
  return Number(m[1]);
}
/** The lighter end of a card's gradient: the color its rule gives to --from. */
function cardFrom(selector) {
  const m = html.match(new RegExp(`\\${selector}\\s*\\{[^}]*--from:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(m, `${selector} sets --from`);
  return m[1];
}

test('small text is readable: at least 4.5 to 1 against what it sits on, at the lightest point', () => {
  const cream = cssVar('cream');
  const ink = cssVar('ink');
  const tab = cssVar('tab');
  const highlight = Number(html.match(/\.card::before\s*\{[^}]*radial-gradient\([^,]*,\s*rgba\(255,\s*255,\s*255,\s*([.\d]+)\)/)[1]);
  const lightest = (color) => blend('#ffffff', color, highlight);
  const kiln = lightest(cardFrom('.kiln'));
  const classes = lightest(cardFrom('.classes'));
  const button = inkAlpha('.btn', 'background');
  const smallOpacity = Number(html.match(/\.btn-primary small\s*\{[^}]*opacity:\s*([.\d]+)/)[1]);
  const checks = {
    'cream on the lightest terracotta card': contrast(cream, kiln),
    'cream on the lightest teal card': contrast(cream, classes),
    'a secondary button label on the terracotta card': contrast(cream, blend(ink, kiln, button)),
    'a secondary button label on the teal card': contrast(cream, blend(ink, classes, button)),
    "the subscribe button's second line": contrast(blend(ink, cream, smallOpacity), cream),
    'the disclaimer on the page': contrast(blend(ink, cream, inkAlpha('.disclaimer', 'color')), cream),
    "the tab's second line on the tab": contrast(blend(ink, tab, inkAlpha('.tab span', 'color')), tab),
    'the terracotta label and title accent on the page': contrast(cssVar('terracotta'), cream),
  };
  for (const [what, ratio] of Object.entries(checks)) assert.ok(ratio >= 4.5, `${what}: ${ratio.toFixed(2)}`);
});

test('the README sends subscribers to the page and carries no privacy policy or terms', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /https:\/\/gbrunow\.github\.io\/hf-community\//);
  assert.doesNotMatch(readme, /^## (Privacy policy|Terms)/m);
  assert.doesNotMatch(readme, /privacy policy|provided as is/i);
});
