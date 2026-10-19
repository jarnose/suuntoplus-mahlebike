# Mahle eBike - a SuuntoPlus app for the Suunto Race

Shows a Mahle (ebikemotion X35 / X20, bikes named `iWoc...`) e-bike on the watch during a cycling
workout: assist level, battery %, speed, motor power (voltage x current) and range. **Up / down
buttons change the assist level.** The workout records level, battery, power and range; the summary
shows battery and energy used.

Protocol: the Mahle BLE protocol as documented in `harbour-mahlebike/docs/protocol.md`. Watch-side
findings: `docs/watch-notes.md`.

## Layout

| | |
|---|---|
| `app/` | the SuuntoPlus app (`manifest.json`, `main.js`, `ext1..3.js`, `t.html`) |
| `tests/run.js` | `node tests/run.js`: runs the app in a vm with a mocked watch; 88 real bike frames are checked against the C++ decoder (`tools/gen_expected.sh` regenerates the expected values) |
| `tools/build_variants.py` | builds test variants under other appIds |
| `tools/zappctl/` | zappctl (0BSD, wylandplex), not tracked; `render-template.mjs` patched for `SUUNTOPLUS_EXT_ROOT` / `CHROME_BIN` |
| `editor/` | the unpacked SuuntoPlus Editor extension (Suunto's), not tracked |

## Build, preview, install

```bash
export PATH=$HOME/.local/bin:$PATH        # node 22
node tests/run.js
node editor/extension/node_modules/@suunto-internal/suuntoplus-tools/bin/build-app.js \
  --appID mahlee01 --input app --output out --displayID q          # -> out/mahlee01-q.dev
SUUNTOPLUS_EXT_ROOT=<dir containing suunto.suuntoplus-editor-1.42.0> CHROME_BIN=/usr/bin/chromium \
  node tools/zappctl/render-template.mjs --project app --displays q      # PNG preview
```

Install over the phone that is bonded to the watch (over ssh): stop
`suuntosync-notifyd` and `harbour-suuntosync`, `bluetoothctl disconnect <watch>`, then
`PYTHONPATH=~/zappctl-run/pylib python3 deploy.py ../mahlee01-q.dev --needle race`, and start the daemon again.
Bump `version` and `modificationTime` in `app/manifest.json` for every build.

## Use

Switch the bike on (nothing else may be connected to it: not the phone app, not a Bluetooth proxy),
select **Mahle eBike** among the SuuntoPlus apps of a cycling sport mode, start the workout.

## Status (0.9)

Verified on a Suunto Race and an iWoc8910, including a 64 min commute (2026-10-19): finding the bike, connection,
live values, assist level buttons, the workout log and the summary. Not yet verified: reconnection after leaving
range, the 20-byte frame layouts (other bikes), X20 `HUS` bikes (the search is for `iWoc`).
