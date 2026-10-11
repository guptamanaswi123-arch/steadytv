const test = require('node:test');
const assert = require('node:assert');
const L = require('../shared/logic.js');

const HZ = 15;
function calibrate() {
  const st = new L.SteadyCapture();
  let r;
  for (let i = 0; i < 40 && !(r && r.done); i++) r = st.feed(L.demoPose('stand'));
  assert.ok(r.done, 'stand calibration completes');
  const sit = new L.SteadyCapture({ minDeltaFrom: r.H, swRef: r.torso });
  let s;
  for (let i = 0; i < 40 && !(s && s.done); i++) s = sit.feed(L.demoPose('sit'));
  assert.ok(s.done, 'sit calibration completes');
  return { hStand: r.H, hSit: s.H, torsoRef: r.torso };
}

function runChair(period, opts = {}) {
  const cal = calibrate();
  const tr = new L.ChairStandTracker({ ...cal, ...opts });
  tr.start(0);
  let snap;
  for (let t = 0; t <= 30500; t += 1000 / HZ) {
    const lm = L.demoPose('chair', t / 1000, { period });
    snap = tr.update(lm, t);
    if (snap.finished) break;
  }
  return snap;
}

test('sit calibration waits until the person actually sits', () => {
  const stand = new L.SteadyCapture();
  let r; for (let i = 0; i < 30; i++) r = stand.feed(L.demoPose('stand'));
  const sit = new L.SteadyCapture({ minDeltaFrom: r.H, swRef: r.torso });
  const x = sit.feed(L.demoPose('stand'));
  assert.equal(x.done, false);
});

test('chair stand counts ~12 for a 2.4s period', () => {
  const s = runChair(2.4);
  assert.ok(s.finished);
  assert.ok(s.count >= 12 && s.count <= 13, 'count=' + s.count);
});

test('chair stand counts ~10 for a 3s period', () => {
  const s = runChair(3);
  assert.ok(s.count >= 9 && s.count <= 11, 'count=' + s.count);
});

test('standing still gives zero', () => {
  const cal = calibrate();
  const tr = new L.ChairStandTracker(cal); tr.start(0);
  let s; for (let t = 0; t <= 30500; t += 66) s = tr.update(L.demoPose('sit'), t);
  assert.equal(s.count, 0);
});

test('partial rise at the buzzer counts if over halfway', () => {
  const cal = calibrate();
  const tr = new L.ChairStandTracker(cal); tr.start(0);
  const mk = (h) => L.buildPose({ hipY: h, ankleDx: 1.6 });
  for (let t = 0; t < 29000; t += 66) tr.update(mk(0.7), t);
  // rise to ~70% at the end
  let s; for (let t = 29000; t <= 30500; t += 66) s = tr.update(mk(0.7 - 0.15 * 0.7), t);
  assert.equal(s.count, 1);
  assert.equal(s.partial, true);
});

test('risk table matches CDC cutoffs', () => {
  assert.deepEqual(L.chairStandRisk(11, 72, 'M'), { cutoff: 12, below: true });
  assert.deepEqual(L.chairStandRisk(12, 72, 'M'), { cutoff: 12, below: false });
  assert.deepEqual(L.chairStandRisk(9, 72, 'F'), { cutoff: 10, below: true });
  assert.equal(L.chairStandRisk(3, 92, 'F').cutoff, 4);
  assert.equal(L.chairStandRisk(13, 62, 'M').cutoff, 14);
  assert.equal(L.chairStandRisk(5, 99, 'M').cutoff, 7);
});

function runBalance(stage, failAt) {
  const tr = new L.BalanceStageTracker(stage);
  let s;
  for (let t = 0; t < 40000; t += 1000 / HZ) {
    s = tr.update(L.demoPose('balance', t / 1000, { stage, failAt }), t);
    if (s.passed || s.failed) break;
  }
  return s;
}

for (const st of [1, 2, 3, 4]) {
  test(`balance stage ${st} passes with steady stance`, () => {
    const s = runBalance(st);
    assert.equal(s.passed, true, JSON.stringify(s));
  });
}

test('stage 4 fails when the lifted foot touches down', () => {
  const s = runBalance(4, 5);
  assert.equal(s.failed, true);
});

test('stage 3 does not accept a wide stance', () => {
  const tr = new L.BalanceStageTracker(3, { waitMs: 5000 });
  let s; for (let t = 0; t < 6000; t += 66) s = tr.update(L.buildPose({ ankleDx: 0.8 }), t);
  assert.equal(s.failed, true);
});

test('stage 1 fails when feet move during the hold', () => {
  const tr = new L.BalanceStageTracker(1);
  let s;
  for (let t = 0; t < 12000; t += 66) {
    const dx = t < 4000 ? 0.2 : 1.15; // shuffle feet apart
    s = tr.update(L.buildPose({ ankleDx: dx }), t);
    if (s.passed || s.failed) break;
  }
  assert.equal(s.failed, true);
  assert.match(s.reason, /moved/i);
});

test('summary flags', () => {
  const lo = L.summarize({ age: 72, sex: 'F', chairCount: 12, balanceStagesPassed: 3 });
  assert.equal(lo.level, 'lower');
  const hi = L.summarize({ age: 72, sex: 'F', chairCount: 8, balanceStagesPassed: 2 });
  assert.equal(hi.level, 'higher');
  assert.equal(hi.flags.length, 2);
});

test('chair stand works with shoulders only (laptop webcam: hips and feet not visible)', () => {
  const upper = (lm) => lm.map((p, i) => (i >= 23 ? { ...p, visibility: 0.05 } : p));
  const st = new L.SteadyCapture();
  let r; for (let i = 0; i < 40 && !(r && r.done); i++) r = st.feed(upper(L.demoPose('stand')));
  const sit = new L.SteadyCapture({ minDeltaFrom: r.H, swRef: r.torso });
  let s; for (let i = 0; i < 40 && !(s && s.done); i++) s = sit.feed(upper(L.demoPose('sit')));
  assert.ok(r.done && s.done);
  const tr = new L.ChairStandTracker({ hSit: s.H, hStand: r.H, torsoRef: r.torso }); tr.start(0);
  let snap; for (let t = 0; t <= 30500; t += 66) { snap = tr.update(upper(L.demoPose('chair', t / 1000, { period: 2.4 })), t); if (snap.finished) break; }
  assert.ok(snap.count >= 12 && snap.count <= 13, 'count=' + snap.count);
});

test('sitting still with a slumped sit-calibration does not invent a stand (v0.5 fix)', () => {
  const stand = new L.SteadyCapture();
  let r; for (let i = 0; i < 40 && !(r && r.done); i++) r = stand.feed(L.demoPose('stand'));
  // calibrated "sit" captured while slumped far lower than real upright sitting
  const slumpH = L.upperLevel(L.buildPose({ hipY: 0.8, ankleDx: 1.6 }), r.torso);
  const tr = new L.ChairStandTracker({ hSit: slumpH, hStand: r.H, torsoRef: r.torso });
  // countdown samples while seated upright -> rebaseline
  const seatedH = L.upperLevel(L.demoPose('sit'), r.torso);
  assert.equal(tr.rebaseline(seatedH), true);
  tr.start(0);
  let s; for (let t = 0; t <= 30500; t += 66) s = tr.update(L.demoPose('sit'), t);
  assert.equal(s.count, 0);
});

test('without rebaseline, a never-seated person is not counted at the buzzer', () => {
  const stand = new L.SteadyCapture();
  let r; for (let i = 0; i < 40 && !(r && r.done); i++) r = stand.feed(L.demoPose('stand'));
  const slumpH = L.upperLevel(L.buildPose({ hipY: 0.8, ankleDx: 1.6 }), r.torso);
  const tr = new L.ChairStandTracker({ hSit: slumpH, hStand: r.H, torsoRef: r.torso });
  tr.start(0);
  let s; for (let t = 0; t <= 30500; t += 66) s = tr.update(L.demoPose('sit'), t);
  assert.equal(s.count, 0);
});

test('clock ticks (undefined) do not mark the person as unseen', () => {
  const cal = calibrate();
  const tr = new L.ChairStandTracker(cal); tr.start(0);
  tr.update(L.demoPose('sit'), 0);
  const s = tr.update(undefined, 100);
  assert.equal(s.seen, true);
  assert.ok(s.unseenMs <= 100);
});

test('chair reports unseen time when the camera sees nobody', () => {
  const cal = calibrate();
  const tr = new L.ChairStandTracker(cal); tr.start(0);
  tr.update(L.demoPose('sit'), 0);
  let s; for (let t = 66; t <= 3000; t += 66) s = tr.update(null, t);
  assert.equal(s.seen, false);
  assert.ok(s.unseenMs > 2500);
});

test('balance: losing sight of the person is "lost", not a balance failure', () => {
  const tr = new L.BalanceStageTracker(1);
  let s;
  for (let t = 0; t < 4000; t += 66) s = tr.update(L.buildPose({ ankleDx: 0.7 }), t); // holding
  assert.equal(s.phase, 'holding');
  for (let t = 4000; t < 6000; t += 66) s = tr.update(null, t);
  assert.equal(s.lost, true);
  assert.equal(s.failed, false);
});

test('balance: a short dropout during the hold is forgiven', () => {
  const tr = new L.BalanceStageTracker(3);
  let s;
  for (let t = 0; t < 14000; t += 66) {
    const blink = t > 5000 && t < 5800; // 0.8 s of no detection
    s = tr.update(blink ? null : L.buildPose({ ankleDx: 0.15 }), t);
    if (s.passed || s.failed || s.lost) break;
  }
  assert.equal(s.passed, true, JSON.stringify(s));
});

test('balance stage 4 accepts a small lift and a dim raised ankle', () => {
  const tr = new L.BalanceStageTracker(4);
  let s;
  for (let t = 0; t < 14000; t += 66) {
    const lm = L.buildPose({ ankleDx: 1.0, liftR: 0.12 });
    lm[28] = { ...lm[28], visibility: 0.15 };
    s = tr.update(lm, t);
    if (s.passed || s.failed || s.lost) break;
  }
  assert.equal(s.passed, true, JSON.stringify(s));
});

test('side view: half step vs heel-to-toe are told apart', () => {
  const run = (stage, sep) => { const tr = new L.BalanceStageTracker(stage, { waitMs: 4000 }); let s; for (let t = 0; t < 14000; t += 66) { s = tr.update(L.buildPose({ side: true, sep }), t); if (s.passed || s.failed || s.lost) break; } return s; };
  assert.equal(run(2, 0.26).passed, true, 'half step passes stage 2');
  assert.equal(run(3, 0.52).passed, true, 'full heel-to-toe passes stage 3');
  assert.equal(run(3, 0.26).failed, true, 'half step is NOT accepted as heel-to-toe');
  assert.equal(run(2, 0.55).failed, true, 'heel-to-toe is NOT accepted as half step');
  assert.equal(run(1, 0.02).passed, true, 'feet together passes stage 1 from the side');
});

test('side view: feet moving apart during the hold fails', () => {
  const tr = new L.BalanceStageTracker(3); let s;
  for (let t = 0; t < 12000; t += 66) { s = tr.update(L.buildPose({ side: true, sep: t < 4000 ? 0.45 : 1.3 }), t); if (s.passed || s.failed) break; }
  assert.equal(s.failed, true);
});

test('goals and status: 65-year-old woman with 9 stands and all balance stages', () => {
  const r = L.summarize({ age: 65, sex: 'F', chairCount: 9, balanceStagesPassed: 4 });
  assert.equal(r.status, 'watch'); assert.equal(r.flags.length, 1);
  assert.match(r.goals[0], /at least 11 stands.*2 more/);
});
test('status: two flags and zero flags', () => {
  assert.equal(L.summarize({ age: 70, sex: 'M', chairCount: 5, balanceStagesPassed: 1 }).status, 'talk');
  assert.equal(L.summarize({ age: 70, sex: 'M', chairCount: 14, balanceStagesPassed: 4 }).status, 'good');
});
test('under 60: reference mode, no risk flags', () => {
  const r = L.summarize({ age: 30, sex: 'F', chairCount: 20, balanceStagesPassed: 1 });
  assert.equal(r.mode, 'reference'); assert.equal(r.status, 'info'); assert.equal(r.flags.length, 0);
  assert.match(r.goals[0], /33/);
});
