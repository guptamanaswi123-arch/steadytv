const test = require('node:test');
const assert = require('node:assert');
const L = require('../shared/logic.js');
const X = require('../shared/exercises.js');

function run(id, target, opts = {}, ms = 60000) {
  const tr = X.makeTracker({ ex: id, target });
  let s;
  for (let t = 0; t < ms; t += 66) { s = tr.update((opts.gen || X.demoMove)(id, t / 1000, opts), t); if (s.done) break; }
  return s;
}

for (const [id, target] of [['sitToStand', 5], ['heelRaise', 10], ['miniSquat', 8], ['sideLegRaise', 8], ['march', 10]]) {
  test(`${id}: counts to target`, () => {
    const s = run(id, target);
    assert.equal(s.done, true, JSON.stringify(s));
    assert.equal(s.count, target);
  });
}

test('rep counting takes about one rep per cycle (not double counting)', () => {
  const tr = X.makeTracker({ ex: 'heelRaise', target: 999 });
  let s; for (let t = 0; t < 1500 + 2500 * 6; t += 66) s = tr.update(X.demoMove('heelRaise', t / 1000), t);
  assert.ok(s.count >= 5 && s.count <= 6, 'count=' + s.count);
});

test('half-height movements are not counted and trigger a "higher" hint', () => {
  const s = run('heelRaise', 5, { scale: 0.55 }, 20000);
  assert.equal(s.count, 0);
  assert.equal(s.hint, 'higher');
});

test('standing still counts nothing', () => {
  const tr = X.makeTracker({ ex: 'miniSquat', target: 5 });
  let s; for (let t = 0; t < 10000; t += 66) s = tr.update(L.buildPose({ ankleDx: 1.0 }), t);
  assert.equal(s.count, 0); assert.equal(s.phase, 'active');
});

test('pauses when out of frame and resumes', () => {
  const tr = X.makeTracker({ ex: 'march', target: 10 });
  let s;
  for (let t = 0; t < 4000; t += 66) s = tr.update(X.demoMove('march', t / 1000), t);
  const before = s.count;
  for (let t = 4000; t < 6000; t += 66) s = tr.update(null, t);
  assert.equal(s.paused, true);
  assert.equal(s.count, before);
  for (let t = 6000; t < 30000; t += 66) { s = tr.update(X.demoMove('march', t / 1000), t); if (s.done) break; }
  assert.equal(s.paused, false);
  assert.ok(s.count > before);
});

test('hold exercises complete', () => {
  assert.equal(run('tandemHold', 10).success, true);
  assert.equal(run('oneLegHold', 10).success, true);
});

test('hold retries once, then finishes without success', () => {
  const tr = X.makeTracker({ ex: 'oneLegHold', target: 10 });
  let s;
  for (let t = 0; t < 120000; t += 66) {
    const local = (t % 60000) / 1000;
    s = tr.update(L.demoPose('balance', local, { stage: 4, failAt: 3 }), t);
    if (s.done) break;
  }
  assert.equal(s.done, true); assert.equal(s.success, false); assert.equal(s.attempt, 2);
});

test('plan level follows the weekly check', () => {
  assert.equal(X.levelFromSummary(L.summarize({ age: 70, sex: 'F', chairCount: 6, balanceStagesPassed: 4 })), 1);
  assert.equal(X.levelFromSummary(L.summarize({ age: 70, sex: 'F', chairCount: 14, balanceStagesPassed: 4 })), 2);
  assert.equal(X.planFor(2).length, 6);
});

test('progress stats: weekly goal, streak and trend', () => {
  const now = new Date('2026-10-14T12:00:00').getTime(); // a Wednesday
  const p = X.demoProfile(now);
  const st = X.progressStats(p, now);
  assert.equal(st.weeklyGoal, 3);
  assert.equal(st.totalSessions, 10);
  assert.deepEqual(st.trend.map((x) => x.count), [8, 9, 10]);
  assert.equal(st.firstChair, 8); assert.equal(st.lastChair, 10);
  assert.equal(st.checkDue, true);
  assert.ok(st.sessionsThisWeek >= 1);
});
