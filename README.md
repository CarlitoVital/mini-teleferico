# Teleférico

[Deutsch](README.de.md) · **English**

A minimalist cable car strategy game for the browser. You build the cable car network of **La Paz and El Alto** (Bolivia) on a map modelled on the real topography: the El Alto plateau (~4,050 m), the jagged escarpment of the *Ceja*, the basin of the city centre (~3,600 m), the valley of the Río Choqueyapu and the Zona Sur (~3,250 m).

The game itself is plain HTML5 Canvas and vanilla JavaScript (ES modules) with no build step. It runs on desktop with a mouse and on phones with touch. An optional small Node.js server adds accounts, saved games in your account and a leaderboard. The game is available in **German, English and Spanish**.

## Getting started

### With the server (accounts, saving to your account, leaderboard)

Requirement: Node.js 18 or newer.

```bash
npm install
npm start          # → http://localhost:3000
```

The server serves the game and provides the API under `/api`. Data is stored in an SQLite file (`server/data/teleferico.db`, created automatically). Settings via environment variables:

| Variable | Meaning |
| --- | --- |
| `PORT` | Server port (default `3000`) |
| `TELEFERICO_DB` | Path to the SQLite database |
| `COOKIE_SECURE=1` | Send the session cookie over HTTPS only (when running behind HTTPS) |
| `TRUST_PROXY` | Behind a reverse proxy: `1` (one proxy), a number of proxies or a list of IPs/CIDR ranges – so that rate limiting sees the real client IP |
| `PUBLIC_ORIGIN` | Public address, e.g. `https://teleferico.example` (several separated by commas). Needed when the proxy rewrites the `Host` header – otherwise the protection against requests from other sites rejects logins and saves. Alternatively, have the proxy pass the host through (nginx: `proxy_set_header Host $host;`). |

Tests (server API, saved games, translations, frontend detection): `npm test`

### Without the server (guest mode only)

Any simple static web server will do; there are no accounts then, everything else works:

```bash
npx serve .
# or
python3 -m http.server 8000   # then open http://localhost:8000
```

> **Note on `file://`:** Many browsers block JavaScript modules when `index.html` is opened directly from disk. The game then shows a notice with the commands above.

## How to play

**Goal:** Get as many passengers as possible to their destination. Your score is the number of passengers delivered.

- **Stations** appear one by one as shapes: circle, triangle, square – later also rare shapes (diamond, star, cross). They are named after real neighbourhoods and tend to appear where the city is built up.
- **Passengers** appear as small shapes next to the stations. Each wants to reach *any* station of their shape, picks the best route through the network on their own and changes lines if needed.
- **Lines** are drawn from station to station. Cable cars only run on **straight cable sections** – the direction changes only at stations.
- **Gondolas** shuttle automatically between the end stations of a line. Each cabin holds 6 passengers (large cabin: 10).
- **Overcrowding:** If more than 6 passengers wait at a station (interchange: 12), a circular timer fills up. When it is full, the game is over. If the number drops again, the timer slowly runs back.
- **Time of day:** Mornings and evenings are rush hour; at night it is quieter and the map gets darker. The small Illimani icon next to the clock changes colour with the time of day.
- **Weeks:** At the start of each week you get a new gondola and choose **one of two rewards**: *New line* (up to 10 colours), *Gondola*, *2 towers*, *Tall tower*, *Large cabin* or *Interchange*.
- **Growing city:** A round starts in a small area around the start location. Week by week the playable area grows and the camera zooms out with it. A typical round lasts 5–15 minutes.

### Terrain

The map is about 25 × 20 km (north up) and is computed from control points in `src/data/terrain.js`: elevation bands in flat colours, fine contour lines, the dashed escarpment of the Ceja, rivers and gorges in blue, and small place names.

- **Towers** (masts) are placed automatically when you build and come from your supply. They are needed
  - for spans longer than 2.3 km,
  - across every **gorge** at least 35 m deep (Choqueyapu, Orkojahuira, Irpavi, Achocalla and many side quebradas),
  - on **steep edges** such as the Ceja (more than 70 m height difference over 240 m),
  - where a ridge would touch the cable (the cable hangs between 18 m high station towers and 30 m high line towers and needs 12 m of ground clearance).
  If your supply is not enough, the preview turns into a red dashed line. When you remove a section, you get its towers back.
- **Altitude:** Gondolas are slower going uphill towards El Alto and a little faster going downhill.
- **Building sites:** Stations only appear on buildable ground – not in gorges or rivers and not on slopes steeper than about 19 %.

### Buildings

The built-up area is generated from the seed and follows the urban areas (grid pattern in El Alto, hillside settlements around the basin, garden suburbs in the Zona Sur):

- **Can be spanned** (light grey): houses, markets, squares, fields. Cables may pass over them.
- **Blocking** (dark, with a symbol): high-rises in the centre and in the Zona Sur, stadiums, hospitals with helipads, barracks, and **El Alto Airport including its approach path**.

While you drag, the game checks every cable section immediately: invalid sections turn red and dashed, cannot be built, and a short notice gives the reason (e.g. “Airport exclusion zone: no cable over the airport or its approach path.”, “The cable needs 1 tall tower over buildings here – available: 0.” or “Not enough towers: …”). With the **Tall tower** reward a cable may span a *single* high-rise, stadium, hospital or barracks – the airport stays off-limits. Tall towers are drawn larger, with a red-and-white top; regular towers are automatically placed next to blocking buildings. Hover over a building with the mouse (touch: tap it briefly) to see what it is.

### Seeds and start areas

Every round starts in a random start area – City centre, El Alto, Zona Sur, Achocalla, Ovejuyo, Villa Fátima or Ciudad Satélite – with three start stations. Everything random (start area, buildings, start stations, the course of the game) depends on a **seed** and the game's own random number generator: **same seed = same map and same start.**

- The seed is shown on the start screen, in the menu and on the game-over screen.
- On the start screen you can enter your own seed (letters and digits, up to 12 characters) or roll a new one with the dice.
- “Same seed” and “Restart (same seed)” play the same map again.

## Language

The game is available in **German, English and Spanish**. Choose the language at the top right of the start screen or in the pause menu (**DE · EN · ES**). It applies immediately – even in the middle of a round and in open dialogs – and is remembered in the browser. On first launch the game follows the browser language (otherwise English).

- Place, station and river names are Spanish proper names and stay the same in every language.
- On errors, the server also returns an error code (`code`, plus `params` where needed); the game uses it to show the message in the selected language.
- All texts live in `src/lang/de.js`, `en.js` and `es.js`. A test checks that all three have the same keys and placeholders and that every key used in the code exists. Adding another language only needs a new dictionary and an entry in `LANGS` (`src/i18n.js`).

## Controls

| Action | Mouse / touch |
| --- | --- |
| Build a new line | Drag from a station across further stations. Dragging back over the last station removes it again. |
| Extend a line | Grab the **T-shaped end** of a line and drag to new stations |
| Shorten a line | Grab the T-shaped end and drag back over the second-to-last station (down to one station = delete the line) |
| Reroute a section | Grab a cable section in the middle and drag it onto one or more stations – they are inserted in between |
| Unhook a station | Grab a cable section and drag it past one of its end stations onto the next station of the line |
| Select a line | Tap a cable section or the colour dot at the bottom |
| Delete a line | Select the line, then **Delete** (or `Del`). The gondolas let everyone off at the next station and return to the depot. |
| Add a gondola | Drag the gondola icon from the bottom bar onto a line |
| Move / remove a gondola | Grab a gondola and drag it onto another line – or drop it anywhere (back to the depot) |
| Large cabin / interchange | Drag the icon from the bar onto a gondola or a station |
| Station info | Hover over a station with the mouse or tap it briefly (name, altitude, waiting passengers) |
| **Pan the map** | Hold the right (or middle) mouse button and drag · touch: drag with two fingers |
| **Zoom** | Mouse wheel or touchpad · touch: pinch with two fingers |
| Recenter the view | Button at the top right (appears after panning) or `C` |

As long as you don't move the camera yourself, it automatically follows the growing city. After panning or zooming it stays where you put it until you recenter the view.

| Key | Function |
| --- | --- |
| `Space` | Pause / resume (you can also build while paused) |
| `1` / `2` | Game speed 1× / 2× – in the reward dialog: choose a reward |
| `+` / `-` | Zoom in / out |
| `C` / `Home` | Recenter the view on the city |
| `Del` / `Backspace` | Delete the selected line |
| `M` | Sound on/off |
| `Esc` | Cancel dragging, clear the selection, close a dialog or open the menu |
| `Enter` | On the start and game-over screens: start a round |

## Saving

- The complete game state is saved: seed, time and week, stations with waiting passengers and timers, lines, gondolas including their passengers and position, towers, supplies, score, random number generator and camera. A loaded game then continues exactly as it was saved.
- **Automatically** every 30 seconds of play and when you leave or hide the page. On the start screen, **Continue** resumes the last round. When a round ends, its autosave is deleted or, in your account, marked as finished – so no other device offers it any more either. A game that was only loaded and not changed does not overwrite the autosave.
- **Manually** via *Menu → Save game* into one of three slots. *Saved games* (start screen and menu) lists all slots with a preview (date, week, score, start area, seed) for loading or deleting. A loaded game starts paused.
- Locally, saves are stored in the browser's **IndexedDB** – separately for the guest and each account, so that after logging out or on a shared computer nobody sees another account's saves. If no storage is available (e.g. private browsing), the game still runs – saves then only last until the page is reloaded.
- Every save carries a version number (`SAVE_VERSION` in `src/save.js`). When loading, it goes through `migrate()`, where future format changes are handled; saves from a newer version of the game are rejected.

## Accounts

Only available when the game runs on the included server. Without logging in, everything stays playable as a **guest** (local saves only).

- **Register / log in** on the start screen under *Log in*. Username 3–24 characters (letters, digits, `_ . -`), password at least 8 characters. The logged-in name is shown small in the corner.
- When logged in, every save is also stored in your **account** (separate account slots in the saved games list) and can be loaded in another browser or on another device.
- After logging in, the game offers to **copy local guest saves to your account**. Occupied account slots are not overwritten; such saves are stored as “Imported N” instead.
- At the end of a round your score is submitted: the **leaderboard** shows the best players and your personal bests. The local high score in the browser is kept as well. The server checks results for plausibility (known start area, valid seed, week matching the time played, no more passengers than can appear in that time); it cannot replay a round, though.
- If your login expires (or you logged out in another tab), the game tells you and only saves locally until you log in again.
- Security: passwords are hashed with bcrypt, the session uses an `HttpOnly` cookie (`SameSite=Lax`, 30 days), input is validated, failed login attempts are limited per IP and per user (successful logins don't count, so that e.g. a school class behind one address doesn't lock itself out), and so are new accounts per IP and hour. Write requests from other sites are rejected. A save may be at most 256 KB, all saves of one account together 2 MB (real saves: 10–60 KB).

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Create an account, log in, log out |
| `GET` | `/api/auth/me` | Logged-in user |
| `GET` | `/api/saves` | List of saves (preview only) |
| `GET` / `PUT` / `DELETE` | `/api/saves/:slot` | Load / store / delete a save |
| `POST` | `/api/scores` | Submit a score |
| `GET` | `/api/scores/me`, `/api/leaderboard` | Personal bests, global leaderboard |

Error responses look like `{ "error": "<German text>", "code": "loginFailed", "params": { … } }`; clients should use `code` to display the message.

## Project structure

```
index.html            Page skeleton, HUD, screens and dialogs
style.css             UI styling (responsive)
src/
  main.js             Entry point, game loop, wiring, autosave, menus, accounts
  game.js             Game state and rules: time/weeks, start area, spawning, network, supplies, game over
  data/terrain.js     Terrain data: plateau, Ceja, rivers, ridges, urban areas, places, start areas, landmarks
  terrain.js          Elevation model from the terrain data, gorges, contour lines
  map.js              Map: drawing, building sites, place names, tower requirements from the terrain profile
  buildings.js        Procedural buildings, blocking buildings, checking cable sections
  station.js          Stations, shapes, waiting passengers, overcrowding timer
  line.js             Lines, parallel offsets, T-shaped ends, towers
  gondola.js          Gondolas: acceleration, swinging on the cable, boarding/alighting/transfers
  passenger.js        Passengers and routing (Dijkstra over station × line with transfer costs)
  render.js           Camera (follow, pan, zoom) and drawing; background cached in tiles
  input.js            Mouse and touch input incl. pinch zoom and camera control
  ui.js               DOM UI: HUD, bar, rewards, saved games, account, leaderboard, language switch
  i18n.js             Language selection, translation function t(), names (colours, shapes, days, start areas)
  lang/               Dictionaries: de.js (source language), en.js, es.js
  save.js             Serialize, load and migrate saved games
  storage.js          Local saves in IndexedDB (with in-memory fallback)
  persist.js          Save slots locally and in the account, importing guest saves
  api.js              Client for the server API
  audio.js            Procedural sounds via the Web Audio API
  autoplay.js         Simple bot for the start screen and the simulation
  config.js           Game constants, line colours, shapes
  util.js             Maths, geometry, seeds and random number generator, storage helpers
server/
  index.js            Entry point (npm start), environment variables
  app.js              Express app: API, validation, serving the frontend
  db.js               SQLite schema (users, sessions, saves, scores)
  session.js          Session tokens and cookies
  ratelimit.js        Simple rate limiting
  config.js           Parsing TRUST_PROXY and PUBLIC_ORIGIN
  plausible.js        Plausibility check for leaderboard entries
tests/                Node tests (npm test)
tools/
  simulate.mjs        Balancing: lets the bot play several rounds headless
  stress.mjs          Stress test with random network changes and invariant checks
```

The game logic (`game.js` and the modules it depends on) needs no DOM and therefore also runs in Node.js:

```bash
node tools/simulate.mjs 12   # 12 bot rounds, shows duration, week and score
node tools/stress.mjs 30     # 30 rounds with random rebuilding while running
```

In the browser console, the running game state is available as `window.__teleferico.game`.

## Notes

Teleférico is an independent game with its own name, its own graphics and its own code. The gameplay is inspired by line-network games; no assets, texts or logos from *Mini Metro* or from the operator of the real cable car network in La Paz are used. Station and place names are names of real neighbourhoods of La Paz and El Alto.

The topography was rebuilt by hand from publicly known map knowledge and is heavily simplified. A map excerpt used as a reference (`reference/la-paz-topo.png`) is deliberately not part of the repository.

Code comments and internal identifiers are in German.
