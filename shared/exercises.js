/*
 * SteadyTV daily routine engine.
 * Home strength-and-balance moves in the style of the Otago Exercise Programme,
 * counted from pose landmarks. Feedback is limited to counting, visibility and "a little higher";
 * it never claims that form or posture is medically correct.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.SteadyExercises = factory(root.SteadyLogic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';
  const I = L.I;
  const vis = (p, m) => !!p && (p.visibility === undefined || p.visibility >= m);
  const avgY = (lm, ids) => ids.reduce((a, i) => a + lm[i].y, 0) / ids.length;
  const torsoLen = (lm) => Math.max(Math.hypot(
    (lm[I.LS].x + lm[I.RS].x) / 2 - (lm[I.LH].x + lm[I.RH].x) / 2,
    (lm[I.LS].y + lm[I.RS].y) / 2 - (lm[I.LH].y + lm[I.RH].y) / 2), 0.02);
  const shW = (lm) => Math.max(Math.abs(lm[I.LS].x - lm[I.RS].x), 0.02);
  const hipX = (lm) => (lm[I.LH].x + lm[I.RH].x) / 2;
  const footOut = (lm) => Math.max(Math.abs(lm[I.LA].x - hipX(lm)), Math.abs(lm[I.RA].x - hipX(lm)));

  /** needs: 'upper' (shoulders) | 'full' (shoulders, hips, knees, ankles). */
  const EXERCISES = {
    sitToStand: {
      kind: 'reps', needs: 'upper', start: 'sit', up: 0.5, down: 0.2,
      base: (lm) => ({ y: (lm[I.LS].y + lm[I.RS].y) / 2, sw: shW(lm) }),
      metric: (lm, b) => (b.y - (lm[I.LS].y + lm[I.RS].y) / 2) / b.sw,
    },
    heelRaise: {
      kind: 'reps', needs: 'full', start: 'stand', up: 0.08, down: 0.03,
      base: (lm) => ({ y: avgY(lm, [I.LS, I.RS, I.LH, I.RH]), torso: torsoLen(lm) }),
      metric: (lm, b) => (b.y - avgY(lm, [I.LS, I.RS, I.LH, I.RH])) / b.torso,
    },
    miniSquat: {
      kind: 'reps', needs: 'full', start: 'stand', up: 0.15, down: 0.05,
      base: (lm) => ({ y: avgY(lm, [I.LH, I.RH]), torso: torsoLen(lm) }),
      metric: (lm, b) => (avgY(lm, [I.LH, I.RH]) - b.y) / b.torso,
    },
    sideLegRaise: {
      kind: 'reps', needs: 'full', start: 'stand', up: 0.35, down: 0.12,
      base: (lm) => ({ off: footOut(lm), sw: shW(lm) }),
      metric: (lm, b) => (footOut(lm) - b.off) / b.sw,
    },
    march: {
      // each knee is tracked on its own channel, so alternating steps count even without a pause between them
      kind: 'reps', needs: 'full', start: 'stand', up: 0.2, down: 0.07,
      base: (lm) => ({ ky: (lm[I.LK].y + lm[I.RK].y) / 2, torso: torsoLen(lm) }),
      metric: (lm, b) => (b.ky - Math.min(lm[I.LK].y, lm[I.RK].y)) / b.torso,
      channels: [(lm, b) => (b.ky - lm[I.LK].y) / b.torso, (lm, b) => (b.ky - lm[I.RK].y) / b.torso],
    },
    tandemHold: { kind: 'hold', needs: 'full', start: 'stand', stage: 3 },
    oneLegHold: { kind: 'hold', needs: 'full', start: 'stand', stage: 4 },
  };

  function visibleFor(needs, lm) {
    if (!lm || lm.length < 29) return false;
    if (needs === 'upper') return L.upperVisible(lm, 0.3);
    return L.bodyVisible(lm, true) && vis(lm[I.LK], 0.4) && vis(lm[I.RK], 0.4);
  }

  /** Counts repetitions with hysteresis. Pauses when the needed body parts go out of view. */
  class RepCounter {
    constructor(id, target, { lostMs = 1000, baseFrames = 12 } = {}) {
      this.id = id; this.ex = EXERCISES[id]; this.target = target;
      Object.assign(this, { lostMs, baseFrames });
      this.phase = 'baseline'; this.count = 0; this.armed = true; this.peak = 0; this.value = 0;
      this.paused = false; this.hint = ''; this.nearMisses = 0; this._bases = []; this._ema = null; this.lostSince = null;
    }
    update(lm, t) {
      if (this.phase === 'done') return this.snapshot();
      if (!visibleFor(this.ex.needs, lm)) {
        if (this.lostSince === null) this.lostSince = t;
        if (t - this.lostSince >= this.lostMs) { this.paused = true; this._bases = []; }
        return this.snapshot();
      }
      this.lostSince = null; this.paused = false;
      if (this.phase === 'baseline') {
        this._bases.push(this.ex.base(lm));
        if (this._bases.length > this.baseFrames) this._bases.shift();
        if (this._bases.length === this.baseFrames) {
          const keys = Object.keys(this._bases[0]);
          const b = {}; for (const k of keys) b[k] = L.median(this._bases.map((x) => x[k]));
          // steady enough? (metric of each sample against the median stays small)
          const spread = Math.max(...this._bases.map((x) => Math.abs(this.ex.metric(this._fake(x, lm), b))));
          if (spread < this.ex.down) { this.b = b; this.phase = 'active'; }
        }
        return this.snapshot();
      }
      if (this.ex.channels) return this._channels(lm);
      const raw = this.ex.metric(lm, this.b);
      this._ema = this._ema === null ? raw : this._ema + 0.5 * (raw - this._ema);
      const v = this.value = this._ema;
      if (this.armed) {
        this.peak = Math.max(this.peak, v);
        if (v >= this.ex.up) {
          this.count++; this.armed = false; this.peak = 0; this.hint = '';
          if (this.count >= this.target) this.phase = 'done';
        } else if (v <= this.ex.down) {
          if (this.peak >= 0.5 * this.ex.up) { this.nearMisses++; this.hint = 'higher'; }
          this.peak = 0;
          // slowly follow small drifts in where the person stands while at rest
          if (Math.abs(v) < this.ex.down * 0.5) {
            const nb = this.ex.base(lm);
            for (const k of Object.keys(this.b)) this.b[k] = this.b[k] * 0.97 + nb[k] * 0.03;
          }
        }
      } else if (v <= this.ex.down) {
        this.armed = true;
      }
      return this.snapshot();
    }
    _channels(lm) {
      if (!this._ch) this._ch = this.ex.channels.map(() => ({ ema: null, armed: true, peak: 0 }));
      const { up, down } = this.ex;
      let maxV = -1;
      this.ex.channels.forEach((fn, i) => {
        const c = this._ch[i];
        const raw = fn(lm, this.b);
        c.ema = c.ema === null ? raw : c.ema + 0.5 * (raw - c.ema);
        maxV = Math.max(maxV, c.ema);
        if (c.armed) {
          c.peak = Math.max(c.peak, c.ema);
          if (c.ema >= up) { this.count++; c.armed = false; c.peak = 0; this.hint = ''; }
          else if (c.ema <= down) { if (c.peak >= 0.5 * up) { this.nearMisses++; this.hint = 'higher'; } c.peak = 0; }
        } else if (c.ema <= down) c.armed = true;
      });
      this.value = maxV;
      if (this.count >= this.target) { this.count = this.target; this.phase = 'done'; }
      return this.snapshot();
    }
    // helper so the steadiness check can reuse metric(): returns lm for sample x (we only need lm itself)
    _fake(_, lm) { return lm; }
    snapshot() {
      return {
        id: this.id, kind: 'reps', phase: this.phase, count: this.count, target: this.target,
        value: this.value, up: this.ex.up, paused: this.paused, needs: this.ex.needs,
        hint: this.hint, done: this.phase === 'done',
      };
    }
  }

  /** Timed balance hold for the routine. Gentle: retries instead of ending. */
  class HoldExercise {
    constructor(id, seconds, { attempts = 2 } = {}) {
      this.id = id; this.ex = EXERCISES[id]; this.target = seconds; this.attempts = attempts;
      this.attempt = 1; this.best = 0; this.paused = false; this.phase = 'active'; this.hint = '';
      this._new();
    }
    _new() { this.tr = new L.BalanceStageTracker(this.ex.stage, { holdMs: this.target * 1000, waitMs: 45000, lostMs: 1000 }); }
    update(lm, t) {
      if (this.phase === 'done') return this.snapshot();
      const s = this.tr.update(lm, t);
      this.paused = !s.visible;
      this.last = s;
      this.best = Math.max(this.best, Math.round(s.heldMs / 1000));
      if (s.passed) { this.best = this.target; this.phase = 'done'; this.success = true; }
      else if (s.lost) { this._new(); }                 // just restart quietly once visible again
      else if (s.failed) {
        if (this.attempt < this.attempts) { this.attempt++; this.hint = 'again'; this._new(); }
        else { this.phase = 'done'; this.success = false; }
      }
      return this.snapshot();
    }
    snapshot() {
      const s = this.last || {};
      return {
        id: this.id, kind: 'hold', phase: this.phase, target: this.target, heldMs: s.heldMs || 0,
        holding: s.phase === 'holding', paused: this.paused, needs: 'full', hint: this.hint,
        attempt: this.attempt, best: this.best, done: this.phase === 'done', success: !!this.success, view: s.view,
      };
    }
  }

  function makeTracker(item) {
    return EXERCISES[item.ex].kind === 'hold' ? new HoldExercise(item.ex, item.target) : new RepCounter(item.ex, item.target);
  }

  // Plans: level 1 if the weekly check raised any flag, else level 2. Holds are in seconds.
  const PLANS = {
    1: [['sitToStand', 5], ['heelRaise', 10], ['march', 10], ['sideLegRaise', 8], ['tandemHold', 10]],
    2: [['sitToStand', 10], ['heelRaise', 15], ['miniSquat', 10], ['sideLegRaise', 12], ['tandemHold', 20], ['oneLegHold', 10]],
  };
  const planFor = (level) => (PLANS[level] || PLANS[1]).map(([ex, target]) => ({ ex, target }));
  const levelFromSummary = (sum) => (sum.flags && sum.flags.length ? 1 : 2);

  // ---------- progress ----------
  const DAY = 86400000;
  const WEEKLY_GOAL = 3; // Otago-style programmes are done about three times a week
  function weekStart(ts) {
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    return d.getTime() - dow * DAY;
  }
  function progressStats(profile, now = Date.now()) {
    const sessions = (profile.sessions || []).filter((s) => s.completed);
    const checks = (profile.assessments || []).filter((a) => typeof a.chairCount === 'number');
    const thisWeek = weekStart(now);
    const sessionsThisWeek = sessions.filter((s) => s.at >= thisWeek).length;
    // consecutive past weeks (including this one if already met) that reached the goal
    let streak = 0;
    for (let w = thisWeek, first = true; ; w -= 7 * DAY, first = false) {
      const n = sessions.filter((s) => s.at >= w && s.at < w + 7 * DAY).length;
      if (n >= WEEKLY_GOAL) streak++;
      else if (!first) break;
      if (w < now - 3650 * DAY) break;
    }
    const trend = checks.map((a) => ({ at: a.at, count: a.chairCount, stages: a.stagesPassed }));
    const all = profile.assessments || [];
    const lastCheck = all.length ? all[all.length - 1].at : null;
    return {
      sessionsThisWeek, weeklyGoal: WEEKLY_GOAL, totalSessions: sessions.length, streakWeeks: streak, trend,
      firstChair: trend.length ? trend[0].count : null, lastChair: trend.length ? trend[trend.length - 1].count : null,
      lastCheck, checkDue: !lastCheck || now - lastCheck >= 7 * DAY,
    };
  }

  /** Demo history (clearly labelled as demo data in the UI). */
  function demoProfile(now = Date.now()) {
    const a = (d, c, st, status) => ({ at: now - d * DAY, chairCount: c, stagesPassed: st, status, mode: 'clinical' });
    const sess = (d) => ({ at: now - d * DAY, level: 1, completed: true, items: [] });
    return {
      id: 'demo', demo: true, age: 72, sex: 'F', lang: 'en', audio: true, level: 1,
      assessments: [a(21, 8, 2, 'talk'), a(14, 9, 3, 'watch'), a(7, 10, 3, 'good')],
      sessions: [21, 19, 17, 14, 12, 10, 7, 5, 3, 1].map(sess),
    };
  }

  // ---------- synthetic movement for tests and demo mode ----------
  function demoMove(id, tSec, opts = {}) {
    const rest = tSec < 1.5;
    const ph = rest ? 0 : (1 - Math.cos((2 * Math.PI * (tSec - 1.5)) / (opts.period || 2.5))) / 2;
    switch (id) {
      case 'sitToStand': return rest ? L.demoPose('sit') : L.demoPose('chair', tSec - 1.5, { period: opts.period || 2.5 });
      case 'heelRaise': return L.buildPose({ ankleDx: 1.0, rise: 0.035 * ph * (opts.scale || 1) });
      case 'miniSquat': return L.buildPose({ ankleDx: 1.0, hipY: 0.55 + 0.06 * ph * (opts.scale || 1) });
      case 'sideLegRaise': return L.buildPose({ ankleDx: 1.0, abdR: 0.9 * ph * (opts.scale || 1) });
      case 'march': {
        const step = Math.floor(Math.max(0, tSec - 1.5) / ((opts.period || 2.5) / 2)) % 2;
        const lift = (rest ? 0 : Math.abs(Math.sin((Math.PI * (tSec - 1.5)) / ((opts.period || 2.5) / 2)))) * 0.9 * (opts.scale || 1);
        return L.buildPose({ ankleDx: 1.0, liftL: step ? lift : 0, liftR: step ? 0 : lift });
      }
      case 'tandemHold': return L.demoPose('balance', tSec, { stage: 3 });
      case 'oneLegHold': return L.demoPose('balance', tSec, { stage: 4 });
      default: return L.demoPose('stand');
    }
  }

  return {
    EXERCISES, PLANS, WEEKLY_GOAL, RepCounter, HoldExercise, makeTracker, planFor, levelFromSummary,
    weekStart, progressStats, demoProfile, demoMove, visibleFor,
  };
});
