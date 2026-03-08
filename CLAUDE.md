# CLAUDE.md

## Project Overview

Soccer Timer is a static web app for youth soccer coaches to track player field time, rotations, and game events. Deployed on Cloudflare Pages at https://soccer.philipjewell.com.

## Tech Stack

- Pure HTML/CSS/JavaScript — no frameworks, no build step
- Cloudflare Pages for hosting (static site)
- Cloudflare Pages Functions for server-side logic (`/functions/api/`)
- localStorage for all persistent state (no backend/database)

## Key Files

- `/v4/script.js` — Main app logic (current version)
- `/v4/index.html` — App UI and modals
- `/v4/styles.css` — App styles
- `/convert/index.html` — Self-contained share link converter (v2/v3/v4)
- `/end/index.html` — Self-contained end-of-season report page
- `/functions/api/resolve-url.js` — Cloudflare Pages Function for short URL resolution
- `/index.html` — Meta refresh redirect to `/v4/`

## Data Architecture

### localStorage Keys
- `soccerTimerV4` — All team data (keyed by team name)
- `soccerTimerV4_prefs` — User preferences (last selected team, etc.)

### v4 Team Data Structure
```json
{
  "controls": { "rotation_time": 5, "notifications": true },
  "gameclock": { "current_quarter": "Q1", "running": false, "run_start": null, "elapsed": { "Q1": 0, "Q2": 0, "Q3": 0, "Q4": 0, "OT": 0 } },
  "roster": [{ "id": "p_...", "name": "...", "is_captain": false, "is_goalkeeper": false, "active": false, "field_time": 0, "session_start": null }],
  "rotation_history": [{ "player": "...", "quarter": "Q1", "time_in": "...", "time_out": "...", "duration": 0 }],
  "event_history": [{ "event_type": "goal", "player": "...", "team": "team", "quarter": "Q1", "time": "...", "timestamp": 123 }]
}
```

### Share Link Compression
Each version uses a different compression scheme (JSON key shortening + base64). When editing compression/decompression, the replacements must be applied in correct order to avoid collisions. Key mappings:

**v4:** `teamName→tn`, `roster→ro`, `rotation_history→rh`, `event_history→eh`, `event_type→et`, `player→p`, `field_time→ft`, `is_captain→ic`, `is_goalkeeper→ig`, etc.

**v3:** `player→p`, `type→tp`, `events→ev`, `teamName→tn`, `team→tm`, `time→ti`, etc.

**v2:** `scorer→sc`, `teamName→tn`, `team→tm`, `time→ti`, etc. (v2 only has `goals`, not `events`)

## Version Differences

| Feature | v2 | v3 | v4 |
|---|---|---|---|
| Events | Goals only (`goals[].scorer`) | All types (`events[].type/player`) | All types (`event_history[].event_type/player`) |
| Roster | `team[]` array | `team[]` array | `roster[]` with `is_captain`, `is_goalkeeper` |
| Rotations | Per-player `rotationLog` | Per-player `rotationLog` | Team-level `rotation_history` |
| Storage | DOM-based | DOM-based | localStorage-first |
| Clock | Counter-based | Counter-based | Timestamp-based (survives refresh) |

## Development Notes

- No build step — edit files and deploy. Cloudflare Pages auto-deploys from `main`.
- The `/convert` and `/end` pages are fully self-contained single HTML files (inline CSS and JS).
- When adding new event types, update: v4 script.js event handling, the `/end` page stats aggregation, and the `/convert` page conversion logic.
- `btoa`/`atob` cannot handle non-Latin1 characters. Use `btoa(unescape(encodeURIComponent(...)))` for encoding and `decodeURIComponent(escape(atob(...)))` for decoding when player names may contain emojis or accented characters.
- The `/functions/api/resolve-url.js` Pages Function exists to follow short URL redirects server-side, avoiding CORS issues that prevent client-side redirect resolution.
