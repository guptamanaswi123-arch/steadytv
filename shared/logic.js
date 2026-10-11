/*
 * SteadyTV core logic (no browser APIs, runs in Node and in the browser).
 * Input: MediaPipe pose landmarks [{x,y,visibility}...] (33 points, normalized 0..1, y grows downward).
 * Implements screening aids modelled on the CDC STEADI "30-Second Chair Stand" and "4-Stage Balance" tests.
 * This is a screening aid, NOT a medical diagnosis.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SteadyLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
  };
  const std = (arr) => {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  };

  // MediaPipe landmark indices we use
  const I = {
    NOSE: 0, LS: 11, RS: 12, LE: 13, RE: 14, LW: 15, RW: 16, LH: 23, RH: 24,
    LK: 25, RK: 26, LA: 27, RA: 28, LHE: 29, RHE: 30, LF: 31, RF: 32,
  };
  // Body-only skeleton lines (face detail left out on purpose)
  const POSE_CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
  ];

  const seenPt = (p, min) => !!p && (p.visibility === undefined || p.visibility >= min) &&
    p.x > -0.02 && p.x < 1.02 && p.y > -0.02 && p.y < 1.02;

  /** True if torso (and optionally both ankles) are confidently inside the frame. */
  function bodyVisible(lm, needAnkles = true) {
    if (!lm || lm.length < 29) return false;
    if (![I.LS, I.RS, I.LH, I.RH].every((i) => seenPt(lm[i], 0.4))) return false;
    return !needAnkles || [I.LA, I.RA].every((i) => seenPt(lm[i], 0.4));
  }

  /** Scale-free body measurements. */
  function metrics(lm, torsoRef) {
    const sh = mid(lm[I.LS], lm[I.RS]);
    const hip = mid(lm[I.LH], lm[I.RH]);
    const ank = mid(lm[I.LA], lm[I.RA]);
    const torso = Math.max(dist(sh, hip), 1e-6);
    const sw = Math.max(Math.abs(lm[I.LS].x - lm[I.RS].x), 1e-6);
    return { sh, hip, ank, torso, sw, H: (ank.y - hip.y) / (torsoRef || torso) };
  }

  /** Shoulders are the one thing every camera reliably sees, so the chair test only needs those. */
  function upperVisible(lm, minVis = 0.2) {
    if (!lm || lm.length < 13) return false;
    return [I.LS, I.RS].every((i) => lm[i] && (lm[i].visibility === undefined || lm[i].visibility >= minVis));
  }
  const shoulderY = (lm) => (lm[I.LS].y + lm[I.RS].y) / 2;
  const shoulderW = (lm) => Math.max(Math.abs(lm[I.LS].x - lm[I.RS].x), 0.02);
  /** Height score: bigger = higher in the frame = more upright. Scale-free via shoulder width. */
  const upperLevel = (lm, swRef) => -shoulderY(lm) / (swRef || shoulderW(lm));

  /** Are both wrists roughly on the chest (arms crossed)? Forgiving: unseen wrists are not punished. */
  function armsCrossed(lm) {
    const lw = lm[I.LW], rw = lm[I.RW];
    if (!lw || !rw || (lw.visibility !== undefined && lw.visibility < 0.2) || (rw.visibility !== undefined && rw.visibility < 0.2)) return true;
    const sw = shoulderW(lm), sy = shoulderY(lm);
    const xmin = Math.min(lm[I.LS].x, lm[I.RS].x) - 0.4 * sw;
    const xmax = Math.max(lm[I.LS].x, lm[I.RS].x) + 0.4 * sw;
    return [lw, rw].every((w) => w.x >= xmin && w.x <= xmax && w.y >= sy - 0.4 * sw && w.y <= sy + 1.4 * sw);
  }

  /**
   * Waits until the person holds still, then returns the median of the steady window.
   * Upper-body only. Pass swRef (from the standing capture) so sitting is measured on the same scale.
   */
  class SteadyCapture {
    constructor({ samples = 22, maxRange = 0.2, minDeltaFrom = null, minDelta = 0.25, swRef = null } = {}) {
      Object.assign(this, { samples, maxRange, minDeltaFrom, minDelta, swRef });
      this.buf = []; this.sws = [];
    }
    reset() { this.buf = []; this.sws = []; }
    feed(lm) {
      if (!upperVisible(lm)) { this.reset(); return { done: false, progress: 0, visible: false }; }
      const v = upperLevel(lm, this.swRef);
      if (this.minDeltaFrom !== null && Math.abs(v - this.minDeltaFrom) < this.minDelta) {
        this.reset();
        return { done: false, progress: 0, visible: true, waiting: true };
      }
      this.buf.push(v); this.sws.push(shoulderW(lm));
      if (this.buf.length > this.samples) { this.buf.shift(); this.sws.shift(); }
      const range = Math.max(...this.buf) - Math.min(...this.buf);
      const full = this.buf.length >= this.samples;
      if (full && range <= this.maxRange) {
        const sw = median(this.sws);
        const H = this.swRef ? median(this.buf) : median(this.buf.map((x, i) => (x * this.sws[i]) / sw));
        return { done: true, progress: 1, visible: true, H, torso: this.swRef || sw };
      }
      return { done: false, progress: full ? 0.5 : (this.buf.length / this.samples) * 0.9, visible: true };
    }
  }

  /**
   * 30-Second Chair Stand counter.
   * level 0 = calibrated sitting height, 1 = calibrated standing height (from the shoulders).
   * A stand counts when level climbs above `up` after having been below `down` (seen seated).
   */
  class ChairStandTracker {
    constructor({ hSit, hStand, torsoRef, durationMs = 30000, strictArms = false, up = 0.75, down = 0.3 }) {
      Object.assign(this, { hSit, hStand, torsoRef, durationMs, strictArms, up, down });
      this.running = false; this.finished = false;
      this.count = 0; this.armsFaults = 0; this.partial = false;
      this.level = 0; this.maxLevel = 0; this.armed = false; this.seen = true; this.armsOk = true;
      this._risingFrames = 0; this._badArms = 0; this._ema = null; this._lastHist = null;
      this.history = []; // [msSinceStart, level] for the result chart
      this.lastSeenT = null;
    }
    /** Re-zero the sitting height from samples taken during the countdown (person is seated). */
    rebaseline(hSit) {
      if (this.hStand - hSit >= 0.3) { this.hSit = hSit; return true; }
      return false;
    }
    start(t) { this.t0 = t; this.running = true; this.finished = false; this.lastSeenT = t; }
    /** lm === undefined means "just a clock tick"; lm === null means "camera sees nobody". */
    update(lm, t) {
      if (!this.running) return this.snapshot(t);
      if (lm !== undefined) {
        this.seen = !!(lm && upperVisible(lm));
        if (this.seen) {
          this.lastSeenT = t;
          const raw = clamp((upperLevel(lm, this.torsoRef) - this.hSit) / (this.hStand - this.hSit), -0.3, 1.4);
          this._ema = this._ema === null ? raw : this._ema + 0.45 * (raw - this._ema);
          this.level = this._ema;
          this.maxLevel = Math.max(this.maxLevel, this.level);
          if (this._lastHist === null || t - this._lastHist >= 100) {
            this.history.push([Math.round(t - this.t0), +this.level.toFixed(3)]);
            this._lastHist = t;
          }
          this.armsOk = armsCrossed(lm);
          if (this.armed) {
            if (this.level > this.down) {
              this._risingFrames++;
              if (!this.armsOk) this._badArms++;
            }
            if (this.level >= this.up) {
              const bad = this._risingFrames > 0 && this._badArms / this._risingFrames > 0.4;
              if (bad) this.armsFaults++;
              if (!(bad && this.strictArms)) this.count++;
              this.armed = false;
            }
          } else if (this.level <= this.down) {
            this.armed = true; this._risingFrames = 0; this._badArms = 0;
          }
        }
      }
      if (t - this.t0 >= this.durationMs) {
        if (this.armed && this.level > 0.5) { this.count++; this.partial = true; }
        this.running = false; this.finished = true;
      }
      return this.snapshot(t);
    }
    snapshot(t) {
      const elapsed = this.running || this.finished ? Math.min(t - this.t0, this.durationMs) : 0;
      return {
        count: this.count, level: this.level, maxLevel: this.maxLevel, armed: this.armed,
        seen: this.seen, armsOk: this.armsOk, armsFaults: this.armsFaults,
        unseenMs: this.running && this.lastSeenT !== null ? t - this.lastSeenT : 0,
        elapsedMs: elapsed, remainingMs: this.durationMs - elapsed, finished: this.finished, partial: this.partial,
      };
    }
  }

  const STAGES = [
    { id: 1, name: 'Feet together', say: 'Stand with your feet side by side, touching each other. Hold for ten seconds.' },
    { id: 2, name: 'Half step', side: true, say: 'Turn sideways, so your left shoulder faces the camera. Move one foot half a step forward, so the middle of that foot touches the big toe of the other foot. Hold for ten seconds.' },
    { id: 3, name: 'Heel to toe', side: true, say: 'Stay sideways to the camera. Put one foot right in front of the other, heel touching toes. Hold for ten seconds.' },
    { id: 4, name: 'One leg', say: 'Stand on one foot. Lift the other foot a little off the floor. Hold for ten seconds.' },
  ];

  /**
   * One stage of the 4-Stage Balance Test (front-camera heuristics).
   * Phases: waiting -> holding -> passed | failed | lost.
   * 'lost' means the camera lost the person (not a balance failure), so the app can offer a retry.
   */
  class BalanceStageTracker {
    constructor(stage, { holdMs = 10000, steadyMs = 1000, graceMs = 1200, waitMs = 30000, lostMs = 1500 } = {}) {
      Object.assign(this, { stage, holdMs, steadyMs, graceMs, waitMs, lostMs });
      this.phase = 'waiting'; this.reason = ''; this.kind = ''; this.hipX = []; this.visible = true;
    }
    _visible(lm) {
      if (!lm) return false;
      if (this.stage !== 4) return bodyVisible(lm);
      // One leg: the raised foot may be partly hidden; the standing foot must be clear.
      if (!bodyVisible(lm, false)) return false;
      const va = lm[I.LA] ? lm[I.LA].visibility ?? 1 : 0, vb = lm[I.RA] ? lm[I.RA].visibility ?? 1 : 0;
      return Math.max(va, vb) >= 0.4 && Math.min(va, vb) >= 0.1;
    }
    _lift(lm, m) {
      const dyA = Math.abs(lm[I.LA].y - lm[I.RA].y);
      const dyH = lm[I.LHE] && lm[I.RHE] ? Math.abs(lm[I.LHE].y - lm[I.RHE].y) : 0;
      return Math.max(dyA, dyH) / m.torso;
    }
    /** Scale unit: shoulder width from the front, ~0.8 torso lengths when turned sideways. */
    _u(m) { return Math.max(m.sw, 0.8 * m.torso); }
    stanceOk(m, lm) {
      const side = m.sw / m.torso < 0.5; // turned sideways to the camera
      this.view = side ? 'side' : 'front';
      const dxA = Math.abs(lm[I.LA].x - lm[I.RA].x);
      const dx = dxA / this._u(m);
      const sepT = dxA / m.torso; // along-the-floor separation, in torso lengths (side view)
      const dy = Math.abs(lm[I.LA].y - lm[I.RA].y) / m.torso;
      if (side && this.stage <= 3) {
        // Side view: foot separation maps to heel-to-toe distance (foot length is ~0.5 torso).
        if (this.stage === 1) return sepT < 0.2 && dy < 0.12;
        if (this.stage === 2) return sepT >= 0.08 && sepT <= 0.4 && dy < 0.2;   // about half a foot apart
        return sepT > 0.4 && sepT <= 1.0 && dy < 0.2;                           // about a full foot apart
      }
      switch (this.stage) {
        case 1: return dx >= 0.1 && dx <= 1.3 && dy < 0.12;
        case 2: return dx <= 0.55 && dy < 0.2;
        case 3: return dx <= 0.3 && dy < 0.2;
        case 4: { const l = this._lift(lm, m); return l >= 0.1 && l <= 1.2; }
        default: return false;
      }
    }
    _standing(lm) { return lm[I.LA].y > lm[I.RA].y ? lm[I.LA] : lm[I.RA]; }
    _refs(lm) {
      if (this.stage === 4) { const s = this._standing(lm); return { a: { x: s.x, y: s.y } }; }
      return { a: { x: lm[I.LA].x, y: lm[I.LA].y }, b: { x: lm[I.RA].x, y: lm[I.RA].y } };
    }
    _drift(lm, m) {
      const r = this.ref;
      if (this.stage === 4) return dist(this._standing(lm), r.a) / this._u(m);
      return Math.max(dist(lm[I.LA], r.a), dist(lm[I.RA], r.b)) / this._u(m);
    }
    update(lm, t) {
      if (this.t0 === undefined) this.t0 = t;
      if (['passed', 'failed', 'lost'].includes(this.phase)) return this.snapshot(t);
      const visible = this._visible(lm);
      this.visible = visible;
      if (!visible) {
        if (this.lostSince === undefined) this.lostSince = t;
        if (this.phase === 'holding') this.lastOk = t; // not seeing you is not evidence you lost balance
        if (t - this.lostSince >= this.lostMs) { this.phase = 'lost'; this.kind = 'lost'; this.reason = 'Lost sight of you'; }
        return this.snapshot(t);
      }
      this.lostSince = undefined;
      const m = metrics(lm);
      const ok = this.stanceOk(m, lm);

      if (this.phase === 'waiting') {
        if (ok) {
          if (this.okSince === undefined) this.okSince = t;
          if (t - this.okSince >= this.steadyMs) {
            this.phase = 'holding'; this.holdStart = t; this.lastOk = t; this.ref = this._refs(lm); this.hipX = [];
          }
        } else this.okSince = undefined;
        if (this.phase === 'waiting' && t - this.t0 >= this.waitMs) this._fail('timeout', 'I could not see you get into position');
      } else if (this.phase === 'holding') {
        if (ok) {
          this.lastOk = t;
          if (this._drift(lm, m) > 0.35) this._fail('moved', 'It looked like your feet moved');
          else this.hipX.push(m.hip.x / this._u(m));
        } else if (t - this.lastOk > this.graceMs) {
          this._fail('stance', this.stage === 4 ? 'It looked like your raised foot touched down' : 'It looked like your feet left the position');
        }
        if (this.phase === 'holding' && t - this.holdStart >= this.holdMs) this.phase = 'passed';
      }
      return this.snapshot(t);
    }
    _fail(kind, reason) { this.phase = 'failed'; this.kind = kind; this.reason = reason; }
    snapshot(t) {
      const held = this.phase === 'holding' ? Math.min(t - this.holdStart, this.holdMs) : this.phase === 'passed' ? this.holdMs : 0;
      return {
        stage: this.stage, phase: this.phase, kind: this.kind, reason: this.reason, heldMs: held,
        remainingMs: this.holdMs - held, sway: std(this.hipX), visible: this.visible, view: this.view || 'front',
        passed: this.phase === 'passed', failed: this.phase === 'failed', lost: this.phase === 'lost',
      };
    }
  }

  // CDC STEADI 30-Second Chair Stand below-average cutoffs: [ageMin, men, women]
  const CHAIR_CUTOFFS = [
    [60, 14, 12], [65, 12, 11], [70, 12, 10], [75, 11, 10], [80, 10, 9], [85, 8, 8], [90, 7, 4],
  ];
  function chairStandRisk(count, age, sex) {
    let row = CHAIR_CUTOFFS[0];
    for (const r of CHAIR_CUTOFFS) if (age >= r[0]) row = r;
    const cutoff = String(sex).toUpperCase().startsWith('M') ? row[1] : row[2];
    return { cutoff, below: count < cutoff };
  }

  const YOUNG_REF = 33; // 81 healthy adults aged 18-35 averaged 33 +/- 5 stands (IJSPT study); no official cut-offs exist

  /**
   * Combine both tests into a plain-language summary with per-person goals.
   * Ages 60+: CDC STEADI cut-offs (clinical). Under 60: no official cut-offs exist, so reference mode only.
   * There is deliberately no invented weighted score: the CDC defines two independent red flags.
   * chairCount null = chair test not completed.
   */
  function summarize({ age, sex, chairCount, balanceStagesPassed }) {
    const clinical = age >= 60;
    const missing = chairCount === null || chairCount === undefined;
    const cut = chairStandRisk(0, Math.max(age, 60), sex).cutoff;
    const chair = { cutoff: cut, missing, below: clinical && !missing && chairCount < cut };
    const tandemOk = balanceStagesPassed >= 3;
    const flags = [];
    const goals = [];
    if (clinical) {
      if (chair.below) flags.push(`Chair stand below average (${chairCount}; below ${cut} is a flag for age ${age})`);
      if (!tandemOk) flags.push('Could not hold the tandem (heel-to-toe) stand for 10 seconds');
      if (missing) goals.push('Redo the chair stand test, it was not completed.');
      else if (chair.below) goals.push(`Chair stand: aim for at least ${cut} stands in 30 seconds. You did ${chairCount}, so ${cut - chairCount} more.`);
      else goals.push(`Chair stand: you met the target of ${cut}. Keep it up and re-test in a few months.`);
    } else {
      goals.push(missing ? 'Redo the chair stand test, it was not completed.'
        : `Chair stand: ${chairCount}. There is no official fall-risk cut-off under 60. For reference, healthy 18-35 year-olds averaged about ${YOUNG_REF} in one study.`);
    }
    if (balanceStagesPassed < 3) goals.push(`Balance: aim to hold the heel-to-toe stand (stage 3) for 10 seconds. Today you reached stage ${balanceStagesPassed}.`);
    else if (balanceStagesPassed === 3) goals.push('Balance: you held the heel-to-toe stand. Next goal: stand on one leg for 10 seconds.');
    else goals.push('Balance: you held all four stages for 10 seconds.');
    if (clinical && flags.length) goals.push('Ask a doctor or physical therapist about strength and balance programs, such as Tai Chi.');

    let status, advice;
    if (!clinical) {
      status = 'info';
      advice = 'The CDC fall-risk benchmarks start at age 60, so these are reference numbers, not a risk rating. Retest to track your own progress.';
    } else if (flags.length === 0) {
      status = 'good';
      advice = missing ? 'No balance flags. The chair test was not completed, so try it again another time.'
        : 'No flags on these two tests. Keep up regular strength and balance activity, and re-check every few months or after any fall or change in health.';
    } else if (flags.length === 1) {
      status = 'watch';
      advice = 'One of the two tests was below the CDC benchmark. That is worth mentioning to a doctor or physical therapist, who can suggest strength and balance work.';
    } else {
      status = 'talk';
      advice = 'Both tests were below the CDC benchmarks, which suggests a higher chance of falling. Please share these results with a doctor or physical therapist.';
    }
    const level = flags.length ? 'higher' : 'lower';
    return { mode: clinical ? 'clinical' : 'reference', status, level, flags, goals, advice, chair, tandemOk, balanceStagesPassed };
  }

  // ---------- Synthetic skeletons (tests + judge-friendly demo mode) ----------
  function buildPose(o = {}) {
    const { hipY = 0.55, ankleDx = 0.7, liftL = 0, liftR = 0, crossed = true, cx = 0.5, side = false, sep = 0, rise = 0, abdR = 0 } = o;
    const torso = 0.25, sw = side ? 0.04 : 0.2;
    const shY = hipY - torso;
    const lm = Array.from({ length: 33 }, () => ({ x: cx, y: shY - 0.1, z: 0, visibility: 0.99 }));
    const set = (i, x, y) => { lm[i] = { x, y, z: 0, visibility: 0.99 }; };
    set(I.NOSE, cx, shY - 0.1);
    set(I.LS, cx - sw / 2, shY); set(I.RS, cx + sw / 2, shY);
    const hh = side ? 0.01 : 0.05;
    set(I.LH, cx - hh, hipY); set(I.RH, cx + hh, hipY);
    const ankY = 0.9;
    const half = side ? (sep * torso) / 2 : (ankleDx * sw) / 2;
    const lax = cx - half, rax = cx + half + abdR * sw;
    const lay = ankY - liftL * torso, ray = ankY - liftR * torso;
    set(I.LA, lax, lay); set(I.RA, rax, ray);
    set(I.LHE, lax, lay + 0.02); set(I.RHE, rax, ray + 0.02);
    set(I.LF, lax - 0.01, lay + 0.035); set(I.RF, rax + 0.01, ray + 0.035);
    set(I.LK, lax, (hipY + lay) / 2); set(I.RK, rax, (hipY + ray) / 2);
    set(I.LE, cx - sw / 2 - 0.03, shY + 0.1); set(I.RE, cx + sw / 2 + 0.03, shY + 0.1);
    if (crossed) { set(I.LW, cx + 0.05, shY + 0.05); set(I.RW, cx - 0.05, shY + 0.05); }
    else { set(I.LW, cx - 0.2, hipY); set(I.RW, cx + 0.2, hipY); }
    if (rise) lm.forEach((p) => { p.y -= rise; });
    return lm;
  }

  /**
   * Demo pose generator. kind: 'stand' | 'sit' | 'chair' | 'balance'.
   * tSec = seconds since this phase began. Deterministic, so it doubles as a test fixture.
   */
  function demoPose(kind, tSec = 0, opts = {}) {
    const STAND = 0.55, SIT = 0.7;
    if (kind === 'stand') return buildPose({ hipY: STAND, ankleDx: 1.6 });
    if (kind === 'sit') return buildPose({ hipY: SIT, ankleDx: 1.6 });
    if (kind === 'chair') {
      const period = opts.period || 2.4;
      const ph = (1 - Math.cos((2 * Math.PI * tSec) / period)) / 2; // 0=sit .. 1=stand
      return buildPose({ hipY: SIT + (STAND - SIT) * ph, ankleDx: 1.6 });
    }
    const stage = opts.stage || 1;
    if (tSec < 1.5) return buildPose({ hipY: STAND, ankleDx: 1.6 });
    const failAt = opts.failAt; // seconds after the 1.5s settle
    const sway = Math.sin(tSec * 1.7) * 0.004;
    const dx = [0, 0.7, 0.4, 0.15, 1.0][stage];
    if (stage === 2) return buildPose({ hipY: STAND, side: true, sep: 0.26, cx: 0.5 + sway });
    if (stage === 3) return buildPose({ hipY: STAND, side: true, sep: 0.52, cx: 0.5 + sway });
    if (stage === 4) {
      const lifted = !(failAt !== undefined && tSec - 1.5 > failAt);
      return buildPose({ hipY: STAND, ankleDx: dx, liftR: lifted ? 0.3 : 0, cx: 0.5 + sway });
    }
    return buildPose({ hipY: STAND, ankleDx: dx, cx: 0.5 + sway });
  }

  return {
    I, STAGES, CHAIR_CUTOFFS, YOUNG_REF, POSE_CONNECTIONS, median,
    bodyVisible, upperVisible, upperLevel, metrics, armsCrossed,
    SteadyCapture, ChairStandTracker, BalanceStageTracker, chairStandRisk, summarize,
    buildPose, demoPose,
  };
});
