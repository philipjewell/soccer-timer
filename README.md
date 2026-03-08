# Soccer Timer

[![Version](https://img.shields.io/badge/version-v4-blue)](https://github.com/philipjewell/soccer-timer/tree/main/v4)
[![Deployed on](https://img.shields.io/badge/deployed%20on-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com)
[![Last Commit](https://img.shields.io/github/last-commit/philipjewell/soccer-timer/main)](https://github.com/philipjewell/soccer-timer/commits/main)

I know what you're thinking: this isn't an original idea. There are so many other apps that allow coaches to manager their youth soccer teams - allowing them to log the time on the field, elect subsitutions, etc.
You are 100% right.

But I didn't like those.

They required me to sign up with an account, had in-app purchases, only allowed me to subsitute Kid1 with Kid3 and didn't account for unpredictability of Kid3 getting a ball straigt to the face and needing Kid7 to take their place - Kid1 can't go back in because they've already had their share of time on the field.

So yeah. I prefered to see the time the kids were on the field. I liked the idea of seeing a running log. I liked the idea of the priority of each kid getting bumped up because their time logged was shorter than the others who had already been in. It is made in the way that I was organically managing my player's time on the field. Hoping it can work for others too!

## Live Site

**https://soccer.philipjewell.com** (redirects to latest version)

## Features

- **Player rotation tracking** — see each player's cumulative field time; players with less time get bumped up in priority
- **Quarter-based game clock** — persistent clock that survives tab close/refresh via timestamp-based tracking
- **Rotation notifications** — audio alert when a player exceeds their rotation time target
- **Event logging** — record goals, penalties, saves, injuries, and other events during the game
- **Captain & goalkeeper designation** — mark players with roles that persist across sessions
- **Multi-team support** — manage multiple teams from the same device with team switching
- **Share links** — generate a compressed URL to share a game snapshot (roster, events, rotation history)
- **Import from v3** — v3 share links are automatically detected and converted on import
- **Delete team** — remove teams you no longer need

## Project Structure

```
/                     Root redirect → /v4/
/v4/                  Current version (localStorage-first architecture)
  index.html          UI markup and modals
  script.js           App logic, data layer, rendering
  styles.css          Styles
/v3/                  Previous version
/v2/                  Legacy version
/convert/             Share link converter between v2, v3, and v4
/end/                 End-of-season awards and stats aggregator
/functions/api/       Cloudflare Pages Functions
  resolve-url.js      Server-side short URL resolver (TinyURL, etc.)
```

## Architecture (v4)

- **localStorage as single source of truth** — all state lives in `localStorage` under the key `soccerTimerV4`; the DOM is a projection of stored data, never the other way around
- **Timestamp-based clock persistence** — the clock stores `run_start` timestamps rather than incrementing counters, so elapsed time is computed on render and survives page reloads
- **Static site on Cloudflare Pages** — no backend, no database, no accounts; one Cloudflare Pages Function exists solely to resolve short URLs server-side (avoiding CORS)
- **Compressed share links** — share data is JSON with shortened keys, base64-encoded, and passed via `?data=` query parameter

## Utility Pages

### `/convert` — Share Link Converter
Converts share links between v2, v3, and v4 formats. Auto-detects the input version and supports all 6 conversion directions. Note: v2 only supports goal events, so non-goal events are dropped when converting to v2.

### `/end` — End-of-Season Report
Paste multiple game share URLs (including TinyURL short links) to generate aggregated player stats, awards, game results, and a shareable report link.
