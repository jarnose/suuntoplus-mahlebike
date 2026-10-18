// Connect to the bike. Found out on the Race (2026-10-18): the watch compares the search bytes with the
// start of the advertised field, the iWoc8910 advertises its name as a SHORTENED local name (AD type 8),
// and a search for the FFE0 service or for a complete name (type 9) also connects here but is not what
// the documentation promises for every bike, so both name types are searched.
function(evHandler) {
  return appConn.connect(
    enabledZappId,
    evHandler,
    [8, 0x69, 0x57, 0x6F, 0x63],
    [9, 0x69, 0x57, 0x6F, 0x63]
  );
}
