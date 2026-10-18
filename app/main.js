// Mahle eBike: shows a Mahle (ebikemotion X35 / X20) e-bike on a Suunto watch and changes its assist
// level with the up / down buttons. Protocol: docs/protocol.md of harbour-mahlebike.
//
// Memory is tight on the watch: no typed arrays, no strings in the hot path, the BLE set-up lives
// in ext1..3.js and is loaded from flash only while it runs.

var conn, st, reg, nreg, link, age, tries, busy, tgt, pend, note, nt, fail,
    spd, lvl, lmin, lmax, soc, pwr, rng, volt, wh, soc0, wh0;

// st: 0 connect, 1 register FFD1, 2 register FFE2, 4 enable notifications, 5 lost, 6 ready, 99 wait
var WAIT = 99, READY = 6;

var u16 = function(d, i) { return (d[i] << 8) | d[i + 1]; };

// a short message in the title for 3 s: 1 write failed, 2 bike refused the level
var say = function(n) {
  note = n;
  nt = 3;
};

// One notification = one frame: "$" type "$" subtype "#" payload "#@". Lengths pick the layout, as
// the iWoc8910 never answers the protocol query: 17-19 bytes are the short ebikemotion frames,
// 20 bytes the later ones.
var onFrame = function(d) {
  var n = d.length;
  if (n < 9 || d[0] != 36 || d[2] != 36 || d[4] != 35) {
    return;
  }
  var t = d[1], s = d[3];
  age = 0;
  if (t == 98 && s == 90 && n >= 17) { // $b$Z battery
    var pack = n == 20 ? u16(d, 16) : (n >= 19 ? u16(d, 15) : 0);
    if (((pack / 10000) | 0) == 2) {
      return; // range extender, not the main pack
    }
    volt = u16(d, 5) / (n == 20 ? 100 : 10);
    soc = d[7] & 0x7f;
    wh = u16(d, 13) / 10;
    if (soc0 === undefined) {
      soc0 = soc;
      wh0 = wh;
    }
  } else if (t == 109 && s == 90 && n >= 18) { // $m$Z motor
    lvl = d[5];
    spd = u16(d, 9) / 36; // 1/10 km/h -> m/s
    // 20-byte frames carry the motor power (1/100 W), short ones the motor current (1/10 A)
    pwr = n >= 20 ? u16(d, 7) / 100 : (volt ? u16(d, 7) / 10 * volt : undefined);
  } else if (t == 106 && s == 90 && n >= 17) { // $j$Z ebm: range
    if (n >= 20) {
      var hij = n >= 18 && d[15] == 72 && d[16] == 73 && d[17] == 74;
      if ((hij ? d[14] : d[15]) != 2) { // slot 2 is trip A, the rest are the lifetime values
        rng = u16(d, 8) * 100;
      }
    } else {
      rng = (d[9] * 16777216 + (d[10] << 16) + (d[11] << 8) + d[12]) / 10;
    }
  } else if (t == 109 && s == 65) { // $m$A assist
    if (n == 10) { // $m$A#<min><max><cur>#@
      lmin = d[5] - 48;
      lmax = d[6] - 48;
    } else if (n == 9) { // $m$A#OK#@ or ER
      if (d[5] == 69) {
        say(2); // refused: the bike has no such level
        if (tgt > lvl && tgt - 1 >= lmin) {
          lmax = tgt - 1;
        }
      }
      busy = 0;
    }
  }
};

var loadExt = function(ix) {
  return evalFile('{file_path}/ext' + ix + '.js');
};

// The set-up steps. Order: FFD1 registered (1), notifications on (4), then FFE2 registered (2). The
// UUIDs in ext2/3.js must be the 2-byte form: the watch accepts the 16-byte base-UUID form too
// (event 107) but then fails every operation on it (reads 103, notifications 110).
var act = function() {
  switch (st) {
    case 0:
      conn = loadExt(1)(bleEventHandler);
      st = WAIT;
      break;
    case 1:
      loadExt(2)(conn);
      st = WAIT;
      break;
    case 2:
      loadExt(3)(conn);
      st = WAIT;
      break;
    case 4:
      appConn.enaCharNotf(conn, 0);
      st = WAIT;
      break;
  }
};

// Enabling notifications straight from the event that makes it due (the bike may drop a link that
// sits idle). Loading a file inside an event handler throws, so only this step is done here.
var quick = function() {
  try {
    act();
  } catch (x) {
    // evaluate() tries again
  }
};

var bleEventHandler = function(ch, e, d) {
  if (e == 106) {
    onFrame(d);
    return;
  }
  systemEvent('MB ev ', e, ' ch ', ch, ' st ', st);
  switch (e) {
    case 100: // connected
      link = 1;
      st = nreg ? 4 : 1;
      if (st == 4) {
        quick();
      }
      break;
    case 107: // registered
      if (ch == 0) {
        nreg = 1;
        st = 4;
        quick();
      } else {
        reg = 1;
        st = READY;
      }
      break;
    case 108: // registration failed: without FFE2 the bike can still be read, not controlled
      if (ch == 1) {
        st = READY;
        say(1);
      }
      break;
    case 101: // disconnected, the system reconnects by itself
      link = 0;
      st = 5;
      break;
    case 109: // notifications on
      tries = 0;
      st = reg ? READY : 2;
      break;
    case 110: // enabling failed: try again a few times (one second apart), then give up
      if (++tries < 4) {
        st = 4;
      } else {
        fail = 1;
      }
      break;
    case 104: // write done
      busy = 0;
      break;
    case 105: // write failed
      busy = 0;
      say(1);
      break;
  }
};

// $M$A#<level>#@ : the bike takes the target level as an absolute number
var flush = function() {
  if (pend >= 0 && !busy && st == READY) {
    tgt = pend;
    pend = -1;
    busy = 4;
    appConn.writeChar(conn, 1, [36, 77, 36, 65, 35, 48 + tgt, 35, 64]);
  }
};

function evaluate(input, output) {
  try {
    switch (st) {
      case 0:
      case 1:
      case 2:
      case 4:
        act();
        break;
      case 5:
        spd = lvl = soc = pwr = rng = undefined;
        st = WAIT;
        break;
      case READY:
        if (busy) {
          busy--;
        }
        if (++age > 6) { // nothing from the bike for a while: show dashes, not old numbers
          spd = lvl = soc = pwr = rng = undefined;
        }
        if (nt && !--nt) {
          note = 0;
        }
        try {
          flush();
        } catch (x) {
          say(1);
        }
        break;
    }
  } catch (x) {
    // the step stays due and is tried again on the next call
  }
  // con != 0 closes the system's Searching view. It is closed as soon as the bike is connected, so
  // that the set-up state is visible in the title.
  output.con = link;
  // 0 searching, 1 reconnecting, 2 connected and waiting for data, 3 live, 4 connected and setting up,
  // 5 cannot enable notifications, 6 command failed, 7 bike refused the level (the last two for 3 s)
  output.stat = note ? 5 + note : (fail ? 5 : (st == READY ? (lvl === undefined ? 2 : 3) : (link ? 4 : (nreg ? 1 : 0))));
  output.spd = spd;
  output.lvl = lvl;
  output.lmax = lmax;
  output.soc = soc;
  output.pwr = pwr;
  output.rng = rng;
}

function onLoad(input, output) {
  conn = reg = nreg = link = age = tries = busy = tgt = note = nt = fail = st = 0;
  pend = -1;
  lmin = 0;
  lmax = 5;
  spd = lvl = soc = pwr = rng = volt = wh = soc0 = wh0 = undefined;
  output.con = 0;
}

// up / down buttons: assist level +1 / -1 (the bike confirms in its next motor frame)
function onEvent(input, output, id) {
  if ((id != 1 && id != 3) || st != READY || lvl === undefined || busy) {
    return;
  }
  var t = lvl + (id == 1 ? 1 : -1);
  if (t < lmin || t > lmax) {
    return;
  }
  pend = t;
  try {
    flush();
  } catch (x) {
    say(1); // evaluate() tries again
  }
}

function getUserInterface() {
  return { template: 't' };
}

function getSummaryOutputs(input, output) {
  return [
    { id: 'u', name: 'Battery used', format: 'Percentage_Threedigits', value: soc0 === undefined || soc === undefined ? undefined : soc0 - soc },
    { id: 'w', name: 'Energy used Wh', format: 'Count_Threedigits', value: wh0 === undefined || wh === undefined ? undefined : Math.round(wh0 - wh) }
  ];
}
