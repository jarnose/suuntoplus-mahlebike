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
- BLE has no delete in the watch protocol: test variants stay on the watch until removed over USB.
- zappctl runs on the phone (Python 3.11, wheels for bleak/dbus-fast unpacked into a directory,
  `PYTHONPATH`); the notify daemon and the app of harbour-suuntosync have to be stopped while it runs.
