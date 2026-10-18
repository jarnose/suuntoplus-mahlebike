// Runs app/main.js and its ext files in a Node vm with a mocked watch (appConn, evalFile).
// 1. every real frame from an iWoc8910 must decode to what the C++ decoder of harbour-mahlebike says
// 2. the connection state machine and the assist commands do what the watch API documentation says
//
//   node tests/run.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'app');
const hex = s => s.trim().split(/\s+/).map(h => parseInt(h, 16));
let failures = 0, checks = 0;

function check(name, got, want, tol) {
  checks++;
  const ok = tol !== undefined ? Math.abs(got - want) <= tol : Object.is(got, want) || got === want;
  if (!ok) {
    failures++;
    console.log(`FAIL ${name}: got ${got}, want ${want}`);
  }
}

// A fresh watch: main.js loaded, onLoad called, appConn recording what the app asks of it.
function watch(file = 'main.js') {
  const calls = [];
  const appConn = {};
  for (const f of ['connect', 'regUuid', 'readChar', 'writeChar', 'enaCharNotf'])
    appConn[f] = (...a) => { calls.push([f, ...a]); return f === 'connect' ? 7 : undefined; };
  const ctx = vm.createContext({
    appConn, enabledZappId: 1, calls,
    systemEvent: () => {},  // the watch takes any number of arguments
    evalFile: p => vm.runInContext('(' + fs.readFileSync(p.replace('{file_path}', APP), 'utf8') + ')', ctx),
  });
  vm.runInContext(fs.readFileSync(path.join(APP, file), 'utf8'), ctx, { filename: file });
  const out = {};
  ctx.out = out;
  vm.runInContext('onLoad({}, out)', ctx);
  ctx.tick = () => vm.runInContext('evaluate({}, out)', ctx);
  ctx.ble = (ch, e, d) => ctx.bleEventHandler(ch, e, d);
  ctx.press = id => vm.runInContext(`onEvent({}, out, ${id})`, ctx);
  return ctx;
}

// Walks the connection set-up the way the watch would.
function connect(w) {
  w.tick();                       // connect
  w.ble(0, 111);                  // connect done
  w.ble(0, 100);                  // connected
  w.tick();                       // register FFD1
  w.ble(0, 107);                  // -> notifications are enabled at once, from the event
  w.ble(0, 109);                  // -> register FFE2 on the next tick
  w.tick();
  w.ble(1, 107);                  // ready
  w.tick();
}

// ---- 1. frames against the C++ reference ------------------------------------------------------
const expected = fs.readFileSync(path.join(__dirname, 'fixtures', 'expected.jsonl'), 'utf8')
  .trim().split('\n').map(l => JSON.parse(l));
const battery = expected.find(e => e.kind === 'battery');

for (const e of expected) {
  const w = watch();
  connect(w);
  const name = e.kind + ' ' + e.hex;
  if (e.kind === 'motor') w.ble(0, 106, hex(battery.hex)); // the power needs the voltage
  w.ble(0, 106, hex(e.hex));
  w.tick();
  const o = w.out;
  if (e.kind === 'battery') {
    check(name + ' soc', o.soc, e.soc);
    check(name + ' wh', w.wh, e.wh, 0.05);
  } else if (e.kind === 'motor') {
    check(name + ' lvl', o.lvl, e.lvl);
    check(name + ' speed', o.spd * 3.6, e.kmh, 0.05);
    check(name + ' power', o.pwr, e.amp * battery.volt, 0.01);
  } else if (e.kind === 'ebm') {
    check(name + ' range', o.rng, e.range_m, 0.5);
  } else if (e.kind === 'assist') {
    check(name + ' max', o.lmax, e.max);
    check(name + ' min', w.lmin, e.min);
  }
}

// ---- 2. connection ----------------------------------------------------------------------------
{
  const w2 = watch();
  w2.tick();
  check('connect called once', w2.calls.filter(c => c[0] === 'connect').length, 1);
  const con = w2.calls.find(c => c[0] === 'connect');
  check('connect handler', typeof con[2], 'function');
  check('search 1 = short name iWoc', JSON.stringify(con[3]), '[8,105,87,111,99]');
  check('search 2 = complete name iWoc', JSON.stringify(con[4]), '[9,105,87,111,99]');
  check('stat searching', w2.out.stat, 0);
  check('con 0 while searching', w2.out.con, 0);

  const w3 = watch();
  connect(w3);
  const reg = w3.calls.filter(c => c[0] === 'regUuid');
  check('two registrations', reg.length, 2);
  check('notify id 0', reg[0][2], 0);
  check('notify char FFD1 as 2 bytes', JSON.stringify(reg[0][4]), '[209,255]');
  check('write id 1', reg[1][2], 1);
  check('write char FFE2 as 2 bytes', JSON.stringify(reg[1][4]), '[226,255]');
  check('service FFE0 as 2 bytes', JSON.stringify(reg[0][3]), '[224,255]');
  check('conn id passed on', reg[0][1], 7);
  const ena = w3.calls.find(c => c[0] === 'enaCharNotf');
  check('enable notifications on id 0', ena && ena[2], 0);
  const order = w3.calls.map(c => c[0] + (c[0] === 'regUuid' ? c[2] : '')).filter(n => n !== 'connect').join();
  check('order: FFD1, notifications, FFE2', order, 'regUuid0,enaCharNotf,regUuid1');
  check('con 1 when connected', w3.out.con, 1);
  check('stat connected, setting up', (() => { const x = watch(); x.tick(); x.ble(0, 100); x.tick(); return x.out.stat; })(), 4);
  check('stat waiting for data', w3.out.stat, 2);

  w3.ble(0, 106, hex(expected.find(e => e.kind === 'motor').hex));
  w3.tick();
  check('stat live', w3.out.stat, 3);

  // stale data turns into dashes
  for (let i = 0; i < 8; i++) w3.tick();
  check('stale speed cleared', w3.out.spd, undefined);
  check('stale stat', w3.out.stat, 2);

  // disconnect and reconnect: no second registration, notifications enabled again
  const before = w3.calls.length;
  w3.ble(0, 101); w3.tick();
  check('con 0 after disconnect', w3.out.con, 0);
  check('stat reconnecting', w3.out.stat, 1);
  w3.ble(0, 100); w3.tick();
  const after = w3.calls.slice(before);
  check('no new registration', after.filter(c => c[0] === 'regUuid').length, 0);
  check('notifications again', after.filter(c => c[0] === 'enaCharNotf').length, 1);
  w3.ble(0, 109); w3.tick();
  check('ready again', w3.out.con, 1);
}

// ---- 2b. notifications refused ------------------------------------------------------------------
{
  const w = watch();
  w.tick(); w.ble(0, 100); w.tick(); w.ble(0, 107);
  const ena = () => w.calls.filter(c => c[0] === 'enaCharNotf').length;
  check('first enable', ena(), 1);
  for (let i = 0; i < 4; i++) { w.ble(0, 110); w.tick(); }
  check('retries three times, then gives up', ena(), 4);
  w.tick();
  check('gives up: stat 5', w.out.stat, 5);
}

// ---- 3. assist commands -----------------------------------------------------------------------
{
  const w = watch();
  connect(w);
  const motor = n => hex('24 6d 24 5a 23 0' + n + ' 15 00 04 00 c1 96 00 00 4f 64 23 40');
  const writes = () => w.calls.filter(c => c[0] === 'writeChar');
  const wire = c => String.fromCharCode(...c[3]);

  w.ble(0, 106, motor(1));
  w.ble(0, 106, hex('24 6d 24 41 23 30 33 31 23 40')); // $m$A#031#@ : levels 0-3, now 1
  w.tick();
  check('range 0-3', w.out.lmax, 3);

  w.press(1);
  check('up writes once', writes().length, 1);
  check('up writes $M$A#2#@', wire(writes()[0]), '$M$A#2#@');
  check('write on id 1', writes()[0][2], 1);

  w.press(1);
  check('a press while a command is out is dropped', writes().length, 1);
  w.ble(1, 104);
  w.ble(0, 106, hex('24 6d 24 41 23 4f 4b 23 40')); // $m$A#OK#@
  w.ble(0, 106, motor(2));
  w.tick();
  check('level 2 shown', w.out.lvl, 2);
  w.press(1);
  check('up again writes $M$A#3#@', wire(writes()[1]), '$M$A#3#@');
  w.ble(1, 104);
  w.ble(0, 106, motor(3));
  w.press(1);
  check('no level above the range', writes().length, 2);

  w.press(3);
  check('down writes $M$A#2#@', wire(writes()[2]), '$M$A#2#@');
  w.ble(1, 105); // write failed
  w.tick();
  check('failure shown in the title (stat 6)', w.out.stat, 6);
  for (let i = 0; i < 4; i++) w.tick();
  check('message fades', w.out.stat !== 6, true);
  w.ble(0, 106, motor(0));
  w.press(3);
  check('no level below the range', writes().length, 3);
  w.press(2);
  check('long press is ignored', writes().length, 3);

  // a refusal teaches the app the cap
  const r = watch();
  connect(r);
  r.ble(0, 106, motor(1));
  r.press(1);
  r.ble(0, 106, hex('24 6d 24 41 23 45 52 23 40')); // $m$A#ER#@
  r.tick();
  check('refusal shown in the title (stat 7)', r.out.stat, 7);
  check('cap learned', r.out.lmax, 1);

  // before the bike is ready or before any data nothing is sent
  const n = watch();
  n.tick();
  n.press(1);
  check('not connected: no write', n.calls.filter(c => c[0] === 'writeChar').length, 0);
}

// ---- 4. noise ---------------------------------------------------------------------------------
{
  const w = watch();
  connect(w);
  for (const junk of [[], [1], [36, 109, 36], hex('24 6d 24 5a 23 01'), hex('52 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 40'),
                      hex('24 62 24 5a 23 01 97 60 0c 00 04 09 90 09 27 27 15 23 40').slice(0, 10)]) {
    try { w.ble(0, 106, junk); } catch (e) { check('junk ' + junk.length + ' throws ' + e.message, 1, 0); }
  }
  w.tick();
  check('junk leaves no speed', w.out.spd, undefined);
}

// ---- 5. summary -------------------------------------------------------------------------------
{
  const w = watch();
  connect(w);
  w.ble(0, 106, hex(battery.hex));
  const s0 = w.getSummaryOutputs({}, {});
  check('summary: nothing used yet', s0[0].value, 0);
  w.ble(0, 106, hex('24 62 24 5a 23 01 97 5c 0c 00 04 09 90 08 00 27 15 23 40'));
  const s1 = w.getSummaryOutputs({}, {});
  check('summary: battery used', s1[0].value, battery.soc - 0x5c);
}

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
