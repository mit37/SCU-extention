# SCU Course Companion

A Chrome extension (Manifest V3) that surfaces professor ratings right on SCU
course/registration pages, so you don't have to alt-tab to RateMyProfessors,
plus lightweight schedule sharing with friends.

## What it does

- **Likeness Score**: on `*.scu.edu` and `*.myworkday.com` pages, the content
  script scans for instructor names (matching Workday's `Last, First` format,
  or `First Last` next to an "Instructor" label) and injects a badge with a
  0–100% score. Click it for a breakdown and a link to the full RMP profile.
- **Blended rating**: the score combines an official SCU course-eval PDF when
  one's been imported (40%, the heaviest weight since it covers the whole
  class rather than self-selected reviewers), RateMyProfessors' average
  rating (33%), "would take again" % (15%), inverted difficulty (6%), and
  signals extracted from crowdsourced syllabi (6%) — see `lib/scoring.js`.
  Any signal that's missing just drops out and the rest renormalize, so a
  professor with only an RMP rating still gets a sensible score. Confidence
  is flagged low/medium/high based on how much data backs it.
- **Official course-eval import**: the Options page lets you import an SCU
  course evaluation PDF for a professor. It's parsed entirely client-side
  with a bundled copy of `pdf.js` (`lib/pdfjs/`) — nothing is uploaded
  anywhere. `Scoring.analyzeEvalText` first looks for Likert-style "X out of
  5" or "X% agreed" figures in the extracted text and averages those; if it
  can't find any (report format varies a lot) it falls back to scanning for
  eval-report phrases associated with well- vs. poorly-received instructors.
- **Syllabus crowdsourcing**: anyone can upload a syllabus (plain text) for a
  professor from the badge popover. The text is scanned for phrases
  associated with fairer/harsher policies (drop-lowest, curves, strict
  no-late-work, mandatory attendance, etc.) and folded into that professor's
  score. Stored locally in `chrome.storage.local`.
- **Manual lookup**: the toolbar popup lets you search any professor by name
  without needing to be on a course page.
- **My Schedule & Friends**: add your classes in the popup, then share them
  via a copy-pasteable code or a pre-filled email (`mailto:`). A friend pastes
  your code into their "Friends" tab to see which classes you share. This is
  intentionally serverless — there's no account system or live sync, just an
  exported/imported snippet — so it works with zero backend infrastructure.

## What it deliberately does *not* do (yet)

- **No live seat-count sync.** Real-time open-seat data lives inside SCU's
  authenticated Workday session and isn't exposed to a third-party extension
  without either scraping the logged-in page (fragile, ToS-sensitive) or a
  backend with its own scraper/integration. This version doesn't fabricate
  that number.
- **No accounts/backend.** Friends and schedule sharing is share-code based
  (client-side only). If you want real-time multi-device sync, "add friend"
  requests, and push notifications for seat openings, that needs a small
  backend (e.g. a couple of endpoints backed by a database) — a natural v2.
- **Name matching is heuristic**, not a guaranteed exact match, especially for
  common surnames. The badge always links to the actual RMP profile so you
  can double check.
- The RateMyProfessors integration (`lib/rmp.js`) uses their public but
  **unofficial** GraphQL endpoint (the same one ratemyprofessors.com's own
  web frontend calls). It could change without notice, and you should confirm
  it's consistent with RMP's terms of service for your use case before wide
  distribution.

## Install (unpacked, for development)

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select the `extension/` folder.
4. Visit an SCU course search page or click the toolbar icon to try a manual
   lookup.

This repo's sandbox couldn't reach `ratemyprofessors.com` to do a live end-to-
end test (outbound network policy), so **test the RMP lookup in a real
browser** before relying on it — if RMP's schema has drifted, `lib/rmp.js` is
the only file that needs updating.

## File layout

```
extension/
  manifest.json
  background.js        # service worker: RMP lookups + caching, syllabus/schedule writes
  lib/
    storage.js          # chrome.storage wrapper (cache, syllabi, course evals, schedule, friends)
    rmp.js              # RateMyProfessors GraphQL client + name matching
    scoring.js           # Likeness Score calculation + eval/syllabus text analysis
    pdfjs/              # bundled pdf.js build, used by the Options page to read eval PDFs locally
  content/
    content.js          # finds instructor names on course pages, injects badges
    content.css
  popup/                # toolbar popup: lookup, my schedule, friends
  options/              # settings: display name, clear data, official eval PDF import
```

## Possible next steps

- A small backend for real accounts, push-based friend requests, and actual
  seat-count polling (would also let syllabi/ratings be shared across all
  users instead of per-browser).
- Extend syllabus uploads (currently `.txt` only, via the badge popover) to
  accept PDFs too, the same way official evals do via `pdf.js` on the Options
  page — held off there for now since content scripts run on arbitrary SCU/
  Workday pages whose own CSP could in principle block spawning the pdf.js
  worker, whereas the Options page is always same-origin with the extension.
- OCR for scanned (image-only) eval or syllabus PDFs, which `pdf.js` text
  extraction can't read since there's no embedded text layer.
- Firefox/Edge builds (the codebase is vanilla MV3 JS with no Chrome-only
  APIs beyond `chrome.*`, which Firefox supports via the `browser.*` polyfill).
