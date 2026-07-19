# LN User Extract

*Notes from developer:* I built this tool for quick extraction of LinkedIn profiles to use with my agents. It's not professional extension and **your feedback for improvements is very welcome!**

What it extracts
----------------

- **Text fields:** URL, Name, Headline, Location, About
- **List of dicts:** Experience (up to 4 most recent): Company name, Title, Years, Location, Content, Links, Skills
- **List of dicts:** Featured (up to 5) and Activity (up to 5) with type and content

## Quick start

1. Open a LinkedIn profile and wait for it to finish loading
2. Click the extension icon in Chrome's toolbar
3. Click "Extract data" - the extension reads the page and shows structured JSON
4. Click "Save profile" - download the last extraction as ln-user-extract-profile.json

Privacy
-------

All processing runs locally in your browser on the open LinkedIn profile page. No external servers are contacted.

Install (developer mode)
------------------------

1. Open chrome://extensions
2. Enable Developer mode
3. Click "Load unpacked" and choose this project's folder

Technical details
-----------------

- manifest.json — extension metadata and permissions (hosts: https://www.linkedin.com/*)
- popup.html/.css/.js — toolbar UI (Extract data, Save profile) and click handlers
- src/parser.js — pure text-parsing logic (unit-tested, no DOM APIs)
- src/content.js — DOM traversal and messaging to parser.js
- test/parser.test.js — unit tests for parser.js

Running tests
-------------

```JavaScript
npm test
```

Limitations
-----------

- LinkedIn's markup can change; heuristics may require updates.
- Very long/virtualized lists may need manual scrolling for full extraction.

Contributing
------------

See CONTRIBUTING.md and .github/ISSUE_TEMPLATE/ for guidance.

Changelog (recent)
------------------

- 1.1.1: Rename to "LN User Extract", UI refresh (black/white/cyan), two-button layout, CI and contributor docs.
