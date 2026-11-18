# hf-community

A Google Apps Script that syncs the Higher Fire studio's shared notes into Google Calendars (see `README.md`), and the calendar page at `https://gbrunow.github.io/hf-community/`.

## Landing page

`index.html` at the repo root is the whole page: inline CSS, a little JavaScript, no framework and no build step. GitHub Pages serves it from `main`. `test/page.test.js` checks it; run `npm test` after any change.

**Copy.** Card headings match the calendars' own names, so a visitor sees the same words in their calendar app. The page must not look official: no Higher Fire logo, colors or type. Keep the disclaimer ("Not an official Higher Fire calendar. Events are generated from the studio's notes using AI, so mistakes can happen.") and the last line naming the maintainer and the studio. The tests hold the exact wording; change copy there too.

**Links.** Each card has a `webcal://` Subscribe link, a Google add link (`calendar.google.com/calendar/r?cid=` plus the calendar ID in base64 without padding) and a Copy link button for the `https://` feed. The calendar IDs come from `subscribeLinks()` in `src/tools.js`. Copy link tries the Clipboard API, then a selected hidden text box, then a prompt showing the link, because some in-app browsers refuse the first two.

**Colors.**

| Use | Value |
|---|---|
| Page | `#F4EDE0` (`--cream`) |
| Help card | `#EADFCB` (`--cream-2`) |
| Text | `#2E2520` (`--ink`) |
| Label, title accent | `#A94A21` (`--terracotta`) |
| Kiln notes card, capsule | gradient `#A94A21` → `#8F3E1B` (`.kiln` `--from`/`--to`) |
| Classes card | gradient `#1F5A64` → `#174850` (`.classes` `--from`/`--to`) |
| Tab | `#FBF7EE` (`--tab`) |
| Secondary buttons | the text color at 18% over the card |
| Card highlight | white at 4%, top-left |

Small text must be at least 4.5:1 against what it sits on, at its lightest point. The contrast test reads these values from `index.html`, so changing one of them re-runs the check; a new text color or element needs its own entry in the test's `checks`. Lighter card colors, a stronger highlight or a cream button fill have all failed it.

**Type.** Jost for the label, title, card headings and the Disclaimer heading; DM Sans for everything else, both from Google Fonts. The Fonts link sends each visitor's IP address to Google; self-hosting the two fonts would avoid that.

**Cards.** Each card's outline is a `::before` box behind its content: a squircle of exponent 2.6, written in CSS as `corner-shape: superellipse(1.38)` (log2 of 2.6), with 64px corners on a phone and 72px from 900px. Browsers without `corner-shape` (Firefox, older Safari) draw plain round corners. The outline is tilted 2° clockwise and the content stays upright. Each card sets its gradient with `--from` and `--to`; the contrast test reads `--from`. Below 900px the cards grow with the window from 390px to 560px, Kiln notes running off the left edge and Classes off the right; from 900px they share the column, at most 560px each. A fine grain filter and a soft two-layer warm shadow. Rounder shapes, overlap, layered and background shapes were tried and rejected.

**Contact group.** The `Say hi` tab and the terracotta e-mail/Instagram capsule are fixed to the bottom of the screen, in an `aside` labelled "Contact". They appear after 40px of downward scroll, after 3 seconds, or when a link in them takes keyboard focus; they hide while scrolling up unless the reveal has lifted them, and stay while focused. After the disclaimer, 260px of extra scroll pins the page and lifts the tab by 60% and the capsule by 30% of it, under a teal overlay. The pin is recomputed on every paint, so it follows the page's height when the web fonts load. All motion is off under `prefers-reduced-motion`.

**Analytics.** Umami Cloud, cookieless, with the script tag in `<head>` (`data-domains="gbrunow.github.io"` keeps local copies out). Clicks are counted by a `data-umami-event` attribute on each link: `subscribe-<kiln|classes>-<webcal|google|copy>` and `contact-<email|instagram|email-name>`. A new link that should be counted gets an attribute in the same pattern, and the test's sorted list of names.

**Layout.** Designed at 390px, one column, no sideways scroll; the cards widen with the window up to 900px. From 900px, a centered column at most 1160px wide, the cards side by side with Classes lowered 90px, the contact group at the right under the Classes card, and slightly larger small type (label and disclaimer 13px, help card 15px).

**Checking changes.** Screenshots cost a lot of request size: take few, small ones (JPEG, 390px or 1280px wide). Check scroll effects by measuring positions in the browser console rather than by looking.
