// Notifications: service FFE0, characteristic FFD1. The UUIDs must be given as 2 bytes (little-endian);
// the 16-byte base-UUID form is accepted at registration but every later operation on it fails.
function(conn) {
  appConn.regUuid(conn, 0, [0xE0, 0xFF], [0xD1, 0xFF]);
}
