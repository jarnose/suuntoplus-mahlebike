# What the Suunto Race taught us about SuuntoPlus BLE apps (2026-10-18)

Measured on a Suunto Race against an iWoc8910 (Mahle X35) bike, with the SuuntoPlus Editor 1.42.0 toolchain.

## Connecting

- `appConn.connect` searches the *start* of an advertised field. The iWoc8910 advertises its name as a
  **shortened local name (AD type 8)** plus the service list FFE0, FE59, 8910, 3DEC, F281.
  All of these found the bike in the end (FFE0 list, type 9 `iWoc`, type 8 `iWoc`): the first tests
  looked like "not found" only because the system's **Searching view hides the app's own screen until
  `output.con` is non-zero**. Set `con` as soon as event 100 (connected) arrives, not when ready.
- The bike allows one connection. Anything else that holds it (an ESPHome Bluetooth proxy, the phone app)
  makes the watch search forever; a bike that is connected stops advertising.

## GATT: the UUID form is what matters

`regUuid(conn, id, service, characteristic)` answers event 107 for any well-formed array, but a
16-byte base-UUID array for a 16-bit UUID (`[0xFB,0x34,...,0xE0,0xFF,0,0]`) makes **every later
operation fail**: `enaCharNotf` -> 110, `readChar` -> 103. The same UUIDs as **2-byte arrays**
(`[0xE0,0xFF]`, `[0xD1,0xFF]`) work. Big-endian 16-byte and an 8 s delay did not help (not recorded
separately). Docs and template only show 128-bit custom UUIDs.

## Event handler limits

- `evalFile` and `regUuid` called from inside the BLE event handler threw (state 1, event 101 followed);
  they run from `evaluate()` (1 Hz). `enaCharNotf` from the handler works.
- Notifications arrive ~10/s on this bike, so the handler decodes with plain arithmetic on the array.

## Other

- `build-app.js` names a `"type":"device"` app `<id>-q.dev`, not `.fea`; zappctl installs it as is
  (`b:/zapp/<id>.dev`). The minifier replaces `output.x` by the manifest position of `x`.
- Up / down buttons: `<pushButton name="up" onClick="$.put('/Zapp/{zapp_index}/Event', 1, null, 'int32');"/>` ->
  `onEvent(input, output, 1)`. Level change `$M$A#<n>#@` through `writeChar` works (FFE2 accepts both
  write types).
- **Corrected 2026-10-18: test variants can be removed over BLE.** zappctl has no delete, which is
  what the earlier note here said - but the watch protocol does: `/FileSystem/Delete` on
  `b:/zapp/<id>.dev` works, measured by deleting a plugin and installing it again
  (harbour-suuntosync's `docs/suuntoplus-and-watchfaces.md`). harbour-suuntosync's SuuntoPlus page
  lists the plugin directory's own files - a `.dev` among them - and removes one from the context
  menu, so a stale test build no longer needs USB.
- zappctl runs on the phone (Python 3.11, wheels for bleak/dbus-fast unpacked into a directory,
  `PYTHONPATH`); the notify daemon and the app of harbour-suuntosync have to be stopped while it runs.

## What a ride recorded (2026-10-19, 64 min incl. a 31 min pause, 4.1 km)

Read from the SML export of harbour-suuntosync (`ZappSample` entries; channel ids 3, 5, 6, 7 = the four
`"log": true` outputs in manifest order: level, battery, power, range).

- 1963-1964 samples per channel at 1 Hz, only while the exercise ran (a single gap = the pause), no dropouts.
- level 0-3 with 13 changes by the buttons, battery 86 -> 83 %, motor power 0-211 W (mean 12 W), range
  95.4 -> 92.5 km (stored in metres, shown with `Distance_Onedecimal`).
- The summary outputs came through: *Battery used* 3 (matches 86 -> 83) and *Energy used Wh* 7.
- harbour-suuntosync's **FIT export does not carry these channels** (no developer fields, no power); the SML
  does. A FIT developer-field export of `ZappSample` would be a feature for harbour-suuntosync.
- **Reconnection**: the bike was switched off and on again during the pause, and the data resumed with the first
  sample after the pause (level 2 -> 1, which is the bike's level after a start; battery 84 %, range 93.75 -> 93.65 km).
  The watch reconnected by itself (event 101, then 100) and the app enabled notifications again without registering
  the UUIDs a second time.
