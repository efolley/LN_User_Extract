# LN User Extract

A Chrome extension that reads the LinkedIn profile page you currently have
open and turns it into structured JSON — name, headline, location, about,
work experience, featured posts, and recent activity. This tool extracts a LinkedIn user's information only; it operates on LinkedIn profile pages and runs locally in the browser. No external scraping or background requests are performed.

Recent changes
--------------
- Added GitHub Actions CI workflow to run tests on push/PR (automated test checks).
- Added CONTRIBUTING.md and issue templates to guide contributors.
- Sanitized .claude/settings.local.json to remove local permissions and avoid leaking approvals.
- Updated package.json metadata (repository, author, keywords, main) to prepare the project for publishing as "LN User Extract".

## Why this exists

LinkedIn's own UI truncates long sections ("…more"), splits multi-role
careers across nested cards, and virtualizes long lists so older content
isn't even in the DOM until you scroll to it. This extension expands
truncated text, walks the actual page structure to reassemble
multi-position work histories under the right company, and hands you back
one clean JSON object instead of a wall of copy-pasted text.

## Output shape

Clicking **Extract Profile Info** produces JSON like this:

```json
{
  "url": "https://www.linkedin.com/in/example/",
  "name": "Jane Smith",
  "headline": "Marketing Lead @ Acme Corp | Ex-Google",
  "location": "San Francisco Bay Area",
  "about": "Results-driven marketing leader with 10+ years...",
  "experience": [
    {
      "Company name": "Acme Corp",
      "Title": "Marketing Lead",
      "Years": "Jan 2022 - Present · 2 yrs",
      "Location": "San Francisco, CA",
      "Content": "Led a team of 5 to grow signups by 40% YoY.",
      "All available links": ["https://www.linkedin.com/company/..."],
      "Skills": ["Growth Marketing", "SQL", "Leadership"]
    }
  ],
  "featured": [
    { "Post type": "post", "Content": "Excited to announce..." }
  ],
  "activity": [
    { "Post type": "post", "Content": "The biggest opportunity is often not..." },
    {
      "Post type": "reshared",
      "Content": "Congrats on this milestone!",
      "Reshared post info": "Original Author • 2nd Founder at Acme 1w • We just shipped a huge feature."
    }
  ]
}
```

- `experience` includes at most the 4 most recent roles.
- `featured` and `activity` include at most the 5 most recent items each,
  and never include a trailing "Show all ..." navigation link.
- `Post type` is `"post"` for original content or `"reshared"` when the
  person reposted someone else's post; reshares additionally carry
  `"Reshared post info"` with the original post's text.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this project's folder.

## Use

1. Open a LinkedIn profile page and make sure it's finished loading.
2. Click the extension icon in Chrome's toolbar.
3. Click **Extract Profile Info** for the full JSON, or use the individual
   **Show full About/Experience section** and **Show last Featured/Activity
   items** buttons to preview just one part.
4. Use **Download JSON** to save the last full extraction to a file.

## Project structure

```
manifest.json      Chrome extension manifest (permissions, popup entry point)
popup.html/.css/.js  The toolbar popup UI and its click handlers
src/
  parser.js         Pure text-parsing logic - no DOM/chrome APIs, unit tested
  content.js        DOM traversal - finds page elements, delegates parsing to parser.js
test/
  parser.test.js    Unit tests for src/parser.js
```

The split between `parser.js` and `content.js` is deliberate: all the
fiddly logic (splitting a name from a headline, telling an employment-type
line apart from a company name, detecting a reshared post) is pure
string/array processing with no dependency on the DOM, so it can be tested
with plain Node instead of a browser.

## Running the tests

```bash
npm test
```

This runs the unit tests in `test/` against `src/parser.js` using Node's
built-in test runner (no dependencies to install).

## Known limitations

- LinkedIn's markup changes over time and varies by account/experiment
  cohort. The DOM- and text-pattern heuristics here were built and verified
  against real profiles as of mid-2026, but may need adjustment if LinkedIn
  changes its layout.
- Long lists (e.g. many experience entries) are virtualized by LinkedIn and
  only rendered near the current scroll position; the extension scrolls the
  relevant section into view before reading, but extremely long profiles
  may still need a manual scroll-and-retry.
- The "Show last N Featured/Activity items" buttons currently return up to
  5 items to match the main extraction, regardless of the "3" in their
  button label.
