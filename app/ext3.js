// Commands: service FFE0, characteristic FFE2 (2-byte UUIDs, see ext2.js)
function(conn) {
  appConn.regUuid(conn, 1, [0xE0, 0xFF], [0xE2, 0xFF]);
}
