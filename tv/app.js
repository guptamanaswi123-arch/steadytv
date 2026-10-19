/* SteadyTV: the TV screen. Big text, D-pad navigation, spoken prompts, English + Hindi.
 * It receives skeleton landmarks from the camera page (or generates them in demo mode)
 * and runs all logic locally (shared/logic.js, shared/exercises.js). */
(() => {
  'use strict';
  const VERSION = 'v1.0';
  const L = window.SteadyLogic;
  const X = window.SteadyExercises;
  const STR = window.STEADY_STRINGS;
  const app = document.getElementById('app');
  const cap = document.getElementById('caption');
  const rand = () => String(Math.floor(1000 + Math.random() * 9000));
  const now = () => performance.now();

  const S = {
    screen: '', tok: 0, room: rand(), demo: false, phone: false, wsOpen: false,
    profile: null, lm: null, lmAt: 0, ar: 0.75, focus: 0, lan: [], lang: 'en', audio: true,
    hStand: null, hSit: null, torso: null,
    chair: null, chairRes: null, stagesPassed: 0, balanceNote: '', session: null,
    tick: null, onPose: null, back: null, items: [], demoPhase: null,
    hosted: false, selfCam: null, httpsPort: null,
  };

  // ---------- language ----------
  function t(key, vars) {
    let s = (STR[S.lang] && STR[S.lang][key]) ?? STR.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
    return s;
  }
  const exName = (id) => t(`ex_${id}`);

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let lastSaid = '', lastSaidAt = 0;
  // On a real Fire TV / Android TV the app shell offers Android's own text-to-speech (SteadyNative);
  // in a normal browser we use the browser's voices. English uses the browser's default voice.
  const NATIVE = (typeof window.SteadyNative === 'object' && typeof window.SteadyNative.speak === 'function') ? window.SteadyNative : null;
  function say(text, { speak = true, force = false } = {}) {
    cap.textContent = (S.audio ? '' : '🔇 ') + text;
    if (!speak || !S.audio || (text === lastSaid && !force)) return;
    lastSaid = text; lastSaidAt = now();
    try {
      if (NATIVE) { NATIVE.speak(text, S.lang); return; }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = S.lang === 'hi' ? 'hi-IN' : 'en-US';
        if (S.lang === 'hi') {
          const v = window.speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('hi'));
          if (v) u.voice = v;
        }
        u.rate = 0.9;
        window.speechSynthesis.speak(u);
      }
    } catch (_) { /* speech is a bonus; captions always show */ }
  }
  const hasVoice = (lang) => {
    try {
      if (NATIVE) return !!NATIVE.hasLang(lang);
      return window.speechSynthesis.getVoices().some((v) => v.lang && v.lang.toLowerCase().startsWith(lang));
    } catch { return false; }
  };
  // Colours used inside drawings (the same tokens as style.css).
  const COL = { fg: '#f7f1e3', mut: '#b5c9c3', gold: '#f5a524', goldSoft: '#ffd99a', ok: '#7fe0b5', line: '#2f5d57', dim: 'rgba(247,241,227,.2)', off: '#4f6b66' };
  // The SteadyTV mark: a spirit level whose bubble sits in the middle.
  const LOGO = `<svg class="mark" viewBox="0 0 64 26" aria-hidden="true"><rect x="2" y="5" width="60" height="16" rx="8" fill="none" stroke="currentColor" stroke-width="3"/>
    <path d="M24 5v16M40 5v16" stroke="currentColor" stroke-width="2" opacity=".55"/><ellipse class="bubble" cx="32" cy="13" rx="6" ry="4.6" fill="${'#f5a524'}"/></svg>`;
  const el = (id) => document.getElementById(id);
  const setText = (id, txt) => { const e = el(id); if (e && e.textContent !== String(txt)) e.textContent = txt; };
  const setWidth = (id, frac) => { const e = el(id); if (e) e.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%'; };
  const label = (it) => (typeof it.label === 'function' ? it.label() : it.label);
  const poseAgeMs = () => now() - S.lmAt;
  const fmtDate = (ts) => new Date(ts).toLocaleDateString(S.lang === 'hi' ? 'hi-IN' : 'en-GB', { day: 'numeric', month: 'short' });

  function stepsHtml(step) {
    if (step === null || step === undefined) return '';
    const names = [t('stepSetup'), t('stepChair'), t('stepBalance'), t('stepResults')];
    return `<div class="steps">${names.map((n, i) =>
      `<span class="${i < step ? 'done' : i === step ? 'on' : ''}">${i < step ? '✓ ' : ''}${n}</span>`).join('')}</div>`;
  }
  function menuHtml(vertical) {
    return `<div class="menu${vertical ? ' vertical' : ''}">${S.items.map((it, i) =>
      `<div class="btn${i === S.focus ? ' focus' : ''}${it.disabled && it.disabled() ? ' disabled' : ''}" data-i="${i}">${label(it)}</div>`).join('')}</div>`;
  }
  function refreshMenu() {
    document.querySelectorAll('.btn[data-i]').forEach((e) => {
      const i = Number(e.dataset.i), it = S.items[i];
      if (!it) return;
      e.className = 'btn' + (i === S.focus ? ' focus' : '') + (it.disabled && it.disabled() ? ' disabled' : '');
      const txt = label(it);
      if (e.innerHTML !== txt) e.innerHTML = txt;
    });
  }
  /** Show a screen. Pending later() callbacks from the previous screen are cancelled. */
  function screen(name, html, items = [], { back = null, tick = null, onPose = null, step = null, focus = 0, vertical = false } = {}) {
    S.tok++; S.screen = name; S.items = items; S.focus = focus; S.back = back; S.tick = tick; S.onPose = onPose;
    document.documentElement.lang = S.lang;
    const bare = name === 'splash' || (name === 'pair' && S.hosted);
    app.innerHTML = (bare ? '' : topBar(stepsHtml(step))) + html.replace('<!--MENU-->', items.length ? menuHtml(vertical) : '');
    app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter');
    updateCamChip();
    app.querySelectorAll('.btn[data-i]').forEach((e) => {
      e.addEventListener('click', () => { S.focus = Number(e.dataset.i); activate(); });
    });
  }
  function topBar(steps = '') {
    return `<header class="top"><div class="brand">${LOGO}<span>SteadyTV</span></div>${steps || '<span></span>'}<div class="top-r" id="camchip"></div></header>`;
  }
  function updateCamChip() {
    const c = el('camchip'); if (!c) return;
    const on = S.demo || S.phone || !!S.selfCam;
    const html = S.screen === 'pair' || S.screen === 'splash' ? ''
      : S.demo ? `<span class="chip warn">${t('demoData')}</span>`
      : `<span class="chip ${on ? 'ok' : ''}"><i class="dot${on ? ' on' : ''}"></i>${on ? t('cameraOn') : t('cameraOff')}</span>`;
    if (c.innerHTML !== html) c.innerHTML = html;
  }
  setInterval(updateCamChip, 1000);
  function later(fn, ms) { const tok = S.tok; setTimeout(() => { if (S.tok === tok) fn(); }, ms); }
  function activate() {
    const it = S.items[S.focus];
    if (!it || (it.disabled && it.disabled())) return;
    if (it.onEnter) it.onEnter();
    refreshMenu();
  }
  function ask({ step, chip = '', title, text, options, speech }) {
    screen('ask', `
      ${chip ? `<div class="chip">${esc(chip)}</div>` : ''}
      <h2>${esc(title)}</h2>
      ${text ? `<div class="card"><p>${esc(text)}</p></div>` : ''}
      <!--MENU-->`, options, { step });
    say(speech || `${title}. ${text || ''}`);
  }

  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (!S.items.length) return;
      const n = S.items.length;
      S.focus = (S.focus + (k === 'ArrowDown' ? 1 : n - 1)) % n;
      refreshMenu(); e.preventDefault();
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const it = S.items[S.focus];
      const fn = it && (k === 'ArrowLeft' ? it.onLeft : it.onRight);
      if (fn) { fn(); refreshMenu(); e.preventDefault(); }
      else if (S.items.length) {
        const n = S.items.length;
        S.focus = (S.focus + (k === 'ArrowRight' ? 1 : n - 1)) % n;
        refreshMenu(); e.preventDefault();
      }
    } else if (k === 'Enter' || k === ' ') {
      activate(); e.preventDefault();
    } else if (k === 'Escape' || k === 'Backspace' || k === 'GoBack') {
      if (S.back) { S.back(); e.preventDefault(); }
    }
  });

  // ---------- profile storage (on the household's own computer) ----------
  // With the home hub (server.js) profiles are files on that computer; the hosted web version keeps them in this browser.
  const lsKey = (id) => `steadytv-profile-${id}`;
  async function loadProfile(id) {
    if (S.hosted) { try { return JSON.parse(localStorage.getItem(lsKey(id)) || 'null'); } catch { return null; } }
    try { const r = await fetch(`../api/profile/${id}`); return await r.json(); } catch { return null; }
  }
  function saveProfile() {
    const p = S.profile; if (!p) return;
    p.lang = S.lang; p.audio = S.audio;
    if (S.hosted) { try { localStorage.setItem(lsKey(p.id), JSON.stringify(p)); } catch (_) {} return; }
    fetch(`../api/profile/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).catch(() => {});
  }
  const familyUrl = () => `http://${S.lan[0] || 'localhost'}:${location.port || 80}/family/${S.profile ? S.profile.id : 'home'}`;

  // ---------- input: pose from the camera page, or demo ----------
  function feedPose(lm) {
    S.lm = lm; S.lmAt = now();
    if (S.onPose) S.onPose(lm, S.lmAt);
  }
  // ---------- voice commands from the phone microphone ----------
  let toastTimer = 0;
  function toast(text) {
    let d = el('toast');
    if (!d) { d = document.createElement('div'); d.id = 'toast'; d.setAttribute('aria-live', 'polite'); document.body.appendChild(d); }
    d.textContent = text; d.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => d.classList.remove('show'), 2200);
  }
  const fakeKey = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  function onVoice(m) {
    const text = String(m.text || '').trim().slice(0, 60);
    const words = text.split(/\s+/).filter(Boolean).length;
    // The phone microphone can hear the TV itself. Commands are short; ignore long sentences and anything the TV just said.
    const echo = now() - lastSaidAt < 8000 && lastSaid.toLowerCase().includes(text.toLowerCase());
    if (!m.cmd || words > 4 || echo) return;
    toast('🎤 ' + text);
    if (m.cmd === 'enter') fakeKey('Enter');
    else if (m.cmd === 'back') fakeKey('GoBack');
    else if (m.cmd === 'up') fakeKey('ArrowUp');
    else if (m.cmd === 'down') fakeKey('ArrowDown');
    else if (m.cmd === 'left') fakeKey('ArrowLeft');
    else if (m.cmd === 'right') fakeKey('ArrowRight');
    else if (m.cmd === 'repeat') { if (lastSaid) say(lastSaid, { force: true }); }
    else if (m.cmd === 'mute') { S.audio = false; try { NATIVE && NATIVE.stop(); window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {} say(lastSaid, { speak: false }); saveProfile(); }
    else if (m.cmd === 'unmute') { S.audio = true; say(lastSaid || '', { force: true }); saveProfile(); }
  }
  let ws = null;
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?room=${S.room}&role=tv`);
    ws.onerror = () => {};
    ws.onopen = () => { S.wsOpen = true; };
    ws.onclose = () => { S.wsOpen = false; S.phone = false; setTimeout(connectWs, 1500); updatePairUi(); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'peers') { S.phone = !!m.phone; updatePairUi(); }
      else if (m.type === 'voice') onVoice(m);
      else if (m.type === 'pose' && !S.demo) {
        if (m.ar) S.ar = m.ar;
        feedPose(m.lm ? m.lm.map(([x, y, v]) => ({ x, y, visibility: v })) : null);
      }
    };
  }
  // Demo mode: synthetic skeleton so judges can run every flow without a camera.
  setInterval(() => {
    if (!S.demo || !S.demoPhase) return;
    const p = S.demoPhase, sec = (now() - p.t0) / 1000;
    feedPose(p.kind === 'ex' ? X.demoMove(p.opts.id, sec) : L.demoPose(p.kind, sec, p.opts));
  }, 66);
  const demoSet = (kind, opts) => { S.demoPhase = { kind, t0: now(), opts }; };
  setInterval(() => { if (S.tick) S.tick(now()); }, 100);

  // ---------- live stick figure: the TV only ever sees this, never video ----------
  const SKEL = '<canvas id="skel" class="skel" width="360" height="480"></canvas>';
  function drawSkel() {
    const c = el('skel'); if (!c) return;
    const g = c.getContext('2d'); const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const ar = S.demo ? 0.75 : S.ar || 0.75;
    let fw = W, fh = W / ar; if (fh > H) { fh = H; fw = H * ar; }
    const ox = (W - fw) / 2, oy = (H - fh) / 2;
    g.strokeStyle = COL.line; g.lineWidth = 3; g.strokeRect(ox + 1.5, oy + 1.5, fw - 3, fh - 3);
    const lm = S.lm;
    if (!lm || poseAgeMs() > 1000) {
      g.fillStyle = COL.mut; g.font = '26px "Atkinson Hyperlegible", Hind, system-ui'; g.textAlign = 'center';
      g.fillText(S.lmAt ? t('nobodyInView') : t('noCameraYet'), W / 2, H / 2);
      return;
    }
    const P = (p) => [ox + (1 - p.x) * fw, oy + p.y * fh];
    const good = (p) => p && (p.visibility === undefined || p.visibility >= 0.4);
    g.lineCap = 'round'; g.lineWidth = 9;
    for (const [a, b] of L.POSE_CONNECTIONS) {
      const p = lm[a], q = lm[b]; if (!p || !q) continue;
      g.strokeStyle = good(p) && good(q) ? COL.fg : COL.dim;
      const [x1, y1] = P(p), [x2, y2] = P(q);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    const nose = lm[0], ls = lm[11], rs = lm[12];
    if (nose && ls && rs) {
      const r = Math.max(10, Math.abs(ls.x - rs.x) * fw * 0.38);
      const [x, y] = P(nose);
      g.strokeStyle = good(nose) ? COL.fg : COL.dim;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
    }
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const p = lm[i]; if (!p) continue;
      const [x, y] = P(p);
      g.fillStyle = good(p) ? COL.gold : COL.off;
      g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
    }
  }
  setInterval(drawSkel, 100);

  // ---------- illustrations ----------
  const CHAIR_FIG = `
    <svg class="figure" viewBox="0 0 160 170" aria-hidden="true">
      <path d="M10 160 H150" stroke="${COL.line}" stroke-width="4"/>
      <g stroke="${COL.mut}" opacity=".6" stroke-width="6" stroke-linecap="round" fill="none"><path d="M88 108 H128 M128 108 V58 M92 108 V160 M124 108 V160"/></g>
      <g class="a" stroke="${COL.fg}" stroke-width="7" stroke-linecap="round" fill="none">
        <circle cx="104" cy="40" r="11"/><path d="M104 54 V104 M104 104 H66 M66 104 V158 M95 64 L113 80 M113 64 L95 80"/>
      </g>
      <g class="b" stroke="${COL.gold}" stroke-width="7" stroke-linecap="round" fill="none">
        <circle cx="70" cy="22" r="11"/><path d="M70 36 V92 M70 92 L68 125 L66 158 M61 46 L79 62 M79 46 L61 62"/>
      </g>
    </svg>`;
  function feetSideSvg(stage) {
    const foot = (x, y) => `<rect x="${x}" y="${y}" width="60" height="22" rx="11" fill="${COL.gold}"/><circle cx="${x + 51}" cy="${y + 11}" r="5" fill="${COL.goldSoft}"/>`;
    const feet = stage === 2 ? foot(20, 50) + foot(50, 76) : foot(20, 50) + foot(80, 76);
    return `<svg class="feet side" viewBox="0 0 170 140" aria-hidden="true">
      <text x="85" y="22" text-anchor="middle" fill="${COL.mut}" font-size="12">${esc(t('sideViewLabel'))}</text>
      ${feet}
      <path d="M85 128 l-14 -12 h8 v-10 h12 v10 h8z" fill="${COL.mut}"/><text x="85" y="140" text-anchor="middle" fill="${COL.mut}" font-size="11">${esc(t('camera'))}</text></svg>`;
  }
  function feetSvg(stage) {
    if (stage === 2 || stage === 3) return feetSideSvg(stage);
    const foot = (x, y, ghost) => ghost
      ? `<rect x="${x}" y="${y}" width="30" height="70" rx="15" fill="none" stroke="${COL.gold}" stroke-width="3" stroke-dasharray="6 6" opacity=".55"/>`
      : `<rect x="${x}" y="${y}" width="30" height="70" rx="15" fill="${COL.gold}"/><circle cx="${x + 15}" cy="${y + 13}" r="7" fill="${COL.goldSoft}"/>`;
    const layouts = { 1: foot(38, 60) + foot(72, 60), 4: foot(48, 60) + foot(86, 46, true) };
    return `<svg class="feet" viewBox="0 0 140 180" aria-hidden="true">
      <text x="70" y="14" text-anchor="middle" fill="${COL.mut}" font-size="12">${esc(t('facingTv'))}</text>${layouts[stage]}</svg>`;
  }
  function sparkSvg(history, up, durationMs) {
    const W = 1000, H = 150, top = 1.2;
    const y = (v) => H - (Math.max(-0.1, Math.min(top, v)) + 0.1) / (top + 0.1) * H;
    const pts = history.map(([tt, v]) => `${(tt / durationMs * W).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line x1="0" x2="${W}" y1="${y(up)}" y2="${y(up)}" stroke="${COL.ok}" stroke-width="2" stroke-dasharray="10 10" vector-effect="non-scaling-stroke"/>
      <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="${COL.line}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <polyline points="${pts}" fill="none" stroke="${COL.gold}" stroke-width="4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="barlbl"><span>${t('start')}</span><span>${t('dashedFullStand')}</span><span>30 s</span></div>`;
  }
  /** Chair-stand trend across weekly checks. */
  function trendSvg(trend) {
    if (!trend.length) return `<p class="muted">${t('noChecksYet')}</p>`;
    const W = 1600, H = 220, pad = 60;
    const max = Math.max(15, ...trend.map((p) => p.count)) + 2;
    const x = (i) => trend.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (trend.length - 1);
    const y = (v) => H - 30 - (v / max) * (H - 60);
    const pts = trend.map((p, i) => `${x(i)},${y(p.count)}`).join(' ');
    const dots = trend.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.count)}" r="9" fill="${COL.gold}"/>
      <text x="${x(i)}" y="${y(p.count) - 18}" text-anchor="middle" fill="${COL.fg}" font-size="26" font-weight="700">${p.count}</text>
      <text x="${x(i)}" y="${H - 4}" text-anchor="middle" fill="${COL.mut}" font-size="20">${esc(fmtDate(p.at))}</text>`).join('');
    return `<svg class="trend" viewBox="0 0 ${W} ${H}"><polyline points="${pts}" fill="none" stroke="${COL.gold}" stroke-width="5"/>${dots}</svg>`;
  }

  // ---------- pairing, profile, home ----------
  function updatePairUi() {
    if (S.screen !== 'pair') return;
    const chip = el('phonechip');
    if (chip) chip.innerHTML = S.phone ? `<span class="chip ok">${t('cameraConnected')}</span>` : `<span class="chip warn">${t('waitingCamera')}</span>`;
    refreshMenu();
  }
  const flipLang = (onChange) => { S.lang = S.lang === 'hi' ? 'en' : 'hi'; try { localStorage.setItem('steadytv-lang', S.lang); } catch (_) {} onChange(); };
  const langItem = (onChange) => ({
    label: () => `${t('language')}: ◀ ${S.lang === 'hi' ? 'हिन्दी' : 'English'} ▶`,
    onLeft: () => flipLang(onChange), onRight: () => flipLang(onChange), onEnter: () => flipLang(onChange),
  });

  const canSelfCam = () => !NATIVE && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  function qrSvg(text) {
    if (typeof window.qrcode !== 'function') return '';
    try {
      const q = window.qrcode(0, 'M'); q.addData(text); q.make();
      const n = q.getModuleCount(); let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      return `<svg class="qr" viewBox="-2 -2 ${n + 4} ${n + 4}" role="img" aria-label="QR code"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#f7f1e3"/><path d="${d}" fill="#0f2624"/></svg>`;
    } catch (_) { return ''; }
  }

  function goPair() {
    S.demo = false;
    if (S.hosted) return goWelcomeWeb();
    const port = location.port || '80';
    const phoneUrl = S.lan.length ? (S.httpsPort ? `https://${S.lan[0]}:${S.httpsPort}` : `http://${S.lan[0]}:${port}`) + `/phone/?room=${S.room}` : '';
    const localUrl = `http://localhost:${port}/phone/?room=${S.room}`;
    const items = [{ label: () => t('continue'), disabled: () => !S.phone, onEnter: () => startWithProfile('home') }];
    if (canSelfCam()) items.push({ label: () => t('useThisCamera'), onEnter: goSelfCam });
    items.push({ label: () => t('tryDemo'), onEnter: () => startWithProfile('demo') });
    items.push(langItem(() => { saveProfile(); goPair(); }));
    screen('pair', `
      <div class="pair">
        <div class="col">
          <h1>${t('pairTitle')}</h1>
          <p class="muted lead">${t('taglineShort')}</p>
          <div class="card">
            <p>${t('pairScan')}</p>
            <p class="url">${esc(phoneUrl || localUrl)}</p>
            ${phoneUrl ? `<p class="small muted">${t('pairLaptop')} ${esc(localUrl)}</p>` : ''}
            <div class="row codeRow"><span class="label">${t('pairCode')}</span><span class="code">${esc(S.room)}</span><span id="phonechip"></span></div>
          </div>
        </div>
        ${phoneUrl ? `<div class="qrbox">${qrSvg(phoneUrl)}</div>` : ''}
      </div>
      <!--MENU-->`, items, { focus: S.phone ? 0 : 1 });
    say(t('sayWelcome'), { speak: false });
    updatePairUi();
  }

  function goWelcomeWeb() {
    const items = [{ label: () => t('tryDemo'), onEnter: () => startWithProfile('demo') }];
    if (canSelfCam()) items.push({ label: () => t('useThisCamera'), onEnter: goSelfCam });
    items.push(langItem(() => { saveProfile(); goPair(); }));
    screen('pair', `
      <div class="welcome">
        <div class="hero">${LOGO}<h1>SteadyTV</h1></div>
        <p class="lead">${t('taglineShort')}</p>
        <div class="card"><p>${t('webIntro')}</p><p class="small muted">${t('webNote')}</p></div>
      </div>
      <!--MENU-->`, items);
    say(t('sayWebWelcome'), { speak: false });
  }

  // "Use this device's camera": pose estimation runs in this browser (hosted version, or a laptop running the TV page).
  async function goSelfCam() {
    const tok = S.tok + 1;
    const status = (k) => { if (S.tok === tok) { setText('camtitle', t(k === 'model' ? 'camModel' : 'camStarting')); } };
    screen('selfcam', `
      <div class="split"><div class="col">
        <h2 id="camtitle">${t('camStarting')}</h2>
        <p class="muted">${t('camAllow')}</p>
        <div class="bar"><i class="busy" style="width:35%"></i></div>
        <p class="small muted">${t('webNote')}</p>
      </div>${SKEL}</div>`, [], { back: goPair });
    try {
      if (S.selfCam) S.selfCam.stop();
      const mod = await import('../shared/posecam.js');
      S.selfCam = await mod.startPoseCamera({
        onStatus: status,
        onPose: (lm, ar) => { if (S.demo) return; if (ar) S.ar = ar; feedPose(lm); },
      });
      if (S.tok !== tok) return;
      startWithProfile('home');
    } catch (e) {
      if (S.tok !== tok) return;
      S.selfCam = null;
      const msg = e && e.name === 'NotAllowedError' ? t('camDenied') : e && e.name === 'NotFoundError' ? t('camNone')
        : e && e.name === 'ModelLoadError' ? t('camModelFail') : t('camError', { msg: (e && e.message) || String(e) });
      ask({ title: t('pairTitle'), text: msg, options: [
        { label: () => t('tryAgain'), onEnter: goSelfCam },
        { label: () => t('tryDemo'), onEnter: () => startWithProfile('demo') },
        { label: () => t('back'), onEnter: goPair },
      ] });
    }
  }

  async function startWithProfile(id) {
    S.demo = id === 'demo';
    let p = S.demo ? X.demoProfile(Date.now()) : await loadProfile(id);
    if (!p) p = { id, assessments: [], sessions: [] };
    p.id = id; p.assessments = p.assessments || []; p.sessions = p.sessions || [];
    if (S.demo) { p.lang = S.lang; p.audio = S.audio; }
    S.profile = p;
    if (p.lang) S.lang = p.lang;
    if (typeof p.audio === 'boolean') S.audio = p.audio;
    saveProfile();
    if (!p.age) goProfile(goHome); else goHome();
  }

  function goProfile(next) {
    const p = S.profile;
    if (!p.age) p.age = 70;
    if (!p.sex) p.sex = 'F';
    const ageIt = {
      label: () => `${t('age')}: ◀ ${p.age} ▶`,
      onLeft: () => { p.age = Math.max(18, p.age - 1); }, onRight: () => { p.age = Math.min(100, p.age + 1); },
    };
    const sexIt = {
      label: () => `${t('sex')}: ◀ ${p.sex === 'F' ? t('female') : t('male')} ▶`,
      onLeft: () => { p.sex = p.sex === 'F' ? 'M' : 'F'; }, onRight: () => { p.sex = p.sex === 'F' ? 'M' : 'F'; },
    };
    screen('profile', `
      <h2>${t('aboutYou')}</h2>
      <p class="muted">${t('aboutYouHelp')}</p>
      <!--MENU-->`, [ageIt, sexIt, { label: () => t('next'), onEnter: () => { saveProfile(); next(); } }], { back: next, focus: 2, vertical: true });
    say(t('sayAboutYou'));
  }

  function greeting() {
    const h = new Date().getHours();
    return t(h < 12 ? 'goodMorning' : h < 17 ? 'goodAfternoon' : 'goodEvening');
  }
  function goHome() {
    const p = S.profile;
    const st = X.progressStats(p);
    const hasPlan = p.assessments.length > 0;
    const pips = Array.from({ length: st.weeklyGoal }, (_, i) => `<i class="${i < st.sessionsThisWeek ? 'on' : ''}">${i < st.sessionsThisWeek ? '✓' : i + 1}</i>`).join('');
    const items = [];
    if (!hasPlan) items.push({ label: () => t('firstCheck'), onEnter: goCheck });
    else {
      items.push({ label: () => t('todaysRoutine'), onEnter: goRoutineIntro });
      items.push({ label: () => t('weeklyCheck') + (st.checkDue ? ` (${t('due')})` : ''), onEnter: goCheck });
    }
    items.push({ label: () => t('myProgress'), onEnter: goProgress });
    items.push({ label: () => t('settings'), onEnter: goSettings });
    const recent = st.trend.slice(-6);
    screen('home', `
      <div class="split home"><div class="col">
          <h1>${esc(greeting())}</h1>
          <p class="lead muted">${hasPlan ? t('homeRoutineReady', { n: currentPlan().length }) : t('homeFirst')}</p>
          <!--MENU-->
        </div>
        <div class="card stats">
          <div class="label">${t('thisWeek')}</div>
          <div class="pips big">${pips}</div>
          <p class="small">${st.sessionsThisWeek >= st.weeklyGoal ? t('goalReachedN', { n: st.sessionsThisWeek }) : t('sessionsOfGoal', { n: st.sessionsThisWeek, goal: st.weeklyGoal })}</p>
          ${st.lastChair !== null ? `<div class="label">${t('lastChairStand')}</div><div class="row" style="gap:1.6rem;align-items:flex-end"><div class="result">${st.lastChair}</div>${miniTrend(recent)}</div>` : ''}
          ${hasPlan && st.checkDue ? `<span class="chip warn">${t('checkDue')}</span>` : ''}
        </div></div>`, items, { vertical: true, back: goPair });
    say(!hasPlan ? t('sayHomeFirst') : st.sessionsThisWeek >= st.weeklyGoal ? t('goalReachedN', { n: st.sessionsThisWeek }) : t('sayHome', { n: st.sessionsThisWeek, goal: st.weeklyGoal }));
    demoSet('stand');
  }
  /** Tiny chair-stand sparkline for the home card. */
  function miniTrend(tr) {
    if (tr.length < 2) return '';
    const W = 160, H = 56, max = Math.max(...tr.map((p) => p.count)) + 1, min = Math.max(0, Math.min(...tr.map((p) => p.count)) - 1);
    const x = (i) => 6 + (i * (W - 12)) / (tr.length - 1), y = (v) => H - 6 - ((v - min) / (max - min || 1)) * (H - 12);
    const pts = tr.map((p, i) => `${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ');
    const last = tr[tr.length - 1];
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${COL.mut}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="${x(tr.length - 1)}" cy="${y(last.count)}" r="6" fill="${COL.gold}"/></svg>`;
  }

  function goSettings() {
    const audioIt = {
      label: () => `${t('audio')}: ◀ ${S.audio ? t('on') : t('off')} ▶`,
      onLeft: () => { S.audio = !S.audio; saveProfile(); goSettingsKeep(1); },
      onRight: () => { S.audio = !S.audio; saveProfile(); goSettingsKeep(1); },
      onEnter: () => { S.audio = !S.audio; saveProfile(); goSettingsKeep(1); },
    };
    function goSettingsKeep(f) { goSettings(); S.focus = f; refreshMenu(); }
    const voiceNote = S.lang === 'hi' && !hasVoice('hi') ? `<p class="small flag">${t('noHindiVoice')}</p>` : '';
    screen('settings', `
      <h2>${t('settings')}</h2>
      ${voiceNote}
      <!--MENU-->
      <p class="small muted">${S.hosted ? t('familyHubOnly') : `${t('familyLink')}: ${esc(familyUrl())}`}</p>`, [
      langItem(() => { saveProfile(); goSettingsKeep(0); }),
      audioIt,
      { label: () => t('ageAndSex'), onEnter: () => goProfile(goSettings) },
      { label: () => t('home'), onEnter: goHome },
    ], { vertical: true, back: goHome });
    say(t('settings'));
  }

  function goProgress() {
    const p = S.profile, st = X.progressStats(p);
    const change = st.trend.length >= 2 ? t('chairChange', { a: st.firstChair, b: st.lastChair }) : '';
    screen('progress', `
      <h2>${t('myProgress')}</h2>
      <div class="grid3">
        <div class="card"><div class="label">${t('thisWeek')}</div><div class="result">${st.sessionsThisWeek}${st.sessionsThisWeek >= st.weeklyGoal ? ' ✓' : ''}</div><p class="small muted">${t('weeklyGoalNote')}</p></div>
        <div class="card"><div class="label">${t('totalSessions')}</div><div class="result">${st.totalSessions}</div></div>
        <div class="card"><div class="label">${t('weeksOnGoal')}</div><div class="result">${st.streakWeeks}</div></div>
      </div>
      <div class="card"><div class="label">${t('chairTrend')}</div>${trendSvg(st.trend)}${change ? `<p class="small">${esc(change)}</p>` : ''}</div>
      <p class="small muted">${t('progressDisclaimer')}</p>
      <!--MENU-->`, [{ label: () => t('home'), onEnter: goHome }], { back: goHome });
    say(change || t('myProgress'));
  }

  // ---------- weekly check (CDC STEADI tests) ----------
  function goCheck() { S.chairRes = null; S.stagesPassed = 0; S.balanceNote = ''; S.savedCheck = false; goCalibrateIntro(); }

  function goCalibrateIntro() {
    screen('calIntro', `
      <h2>${t('setupTitle')}</h2>
      <div class="card">
        <p>${t('setup1')}</p><p>${t('setup2')}</p><p>${t('setup3')}</p>
        <p class="small muted">${t('setupNote')}</p>
      </div>
      <!--MENU-->`, [
      { label: () => t('ready'), onEnter: goCalibrate },
      { label: () => t('back'), onEnter: goHome },
    ], { back: goHome, step: 0 });
    say(t('saySetup'));
    demoSet('stand');
  }

  function goCalibrate() {
    const cal = { step: 'stand', cap: new L.SteadyCapture() };
    screen('calibrate', `
      <div class="split"><div class="col">
        <div class="chip" id="calchip">${t('setupStep', { n: 1 })}</div>
        <h2 id="caltitle">${t('calStandTitle')}</h2>
        <p class="muted" id="caltext">${t('calStandText')}</p>
        <div class="bar"><i id="calbar" style="width:0%"></i></div>
        <div class="hint" id="calhint"></div>
      </div>${SKEL}</div>`, [], {
      step: 0, back: goCalibrateIntro,
      onPose: (lm) => {
        const r = cal.cap.feed(lm);
        setWidth('calbar', r.progress);
        setText('calhint', r.visible ? (r.waiting ? t('waitingToSit') : '') : t('cantSeeShoulders'));
        if (!r.done) return;
        if (cal.step === 'stand') {
          S.hStand = r.H; S.torso = r.torso;
          cal.step = 'sit'; cal.cap = new L.SteadyCapture({ minDeltaFrom: r.H, minDelta: 0.25, swRef: r.torso });
          setText('calchip', t('setupStep', { n: 2 }));
          setText('caltitle', t('calSitTitle'));
          setText('caltext', t('calSitText'));
          say(t('sayCalSit'));
          demoSet('sit');
        } else {
          S.hSit = r.H; S.onPose = null;
          if (S.hStand - S.hSit < 0.3) {
            ask({ step: 0, chip: t('stepSetup'), title: t('calFailTitle'), text: t('calFailText'),
              options: [{ label: () => t('trySetupAgain'), onEnter: goCalibrate }, { label: () => t('back'), onEnter: goCalibrateIntro }] });
            return;
          }
          goChairIntro();
        }
      },
    });
    say(t('sayCalStand'));
    demoSet('stand');
  }

  function goChairIntro() {
    screen('chairIntro', `
      <div class="split"><div class="col">
        <h2>${t('chairTitle')}</h2>
        <div class="card"><p>${t('chairHow1')}</p><p>${t('chairHow2')}</p></div>
        <!--MENU-->
      </div>${CHAIR_FIG}</div>`, [
      { label: () => t('start'), onEnter: goChairRun },
      { label: () => t('back'), onEnter: goCalibrateIntro },
    ], { back: goCalibrateIntro, step: 1 });
    say(t('sayChairIntro'));
    demoSet('sit');
  }

  function goChairRun() {
    const tracker = new L.ChairStandTracker({ hSit: S.hSit, hStand: S.hStand, torsoRef: S.torso });
    S.chair = tracker;
    let phase = 'count', said15 = false, said5 = false, saidMove = false;
    const countFrom = now(), base = [];
    const R = 42, C = 2 * Math.PI * R;
    screen('chair', `
      <div class="split"><div class="col">
        <div class="row" style="gap:3rem">
          <div><div class="label">${t('stands')}</div><div class="big" id="cnt">0</div></div>
          <svg class="ring" viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="${R}"/>
            <circle class="fg" id="ring" cx="50" cy="50" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="0"/>
            <text id="secs" x="50" y="60" text-anchor="middle" font-size="28" fill="${COL.fg}" font-weight="700">30</text></svg>
        </div>
        <div class="cue" id="cue">${t('sitStill')}</div>
        <div><div class="bar"><i id="lvl" style="width:0%"></i></div>
        <div class="barlbl"><span>${t('sitting')}</span><span>${t('standing')}</span></div></div>
        <div class="hint" id="hint"></div>
      </div>${SKEL}</div>`, [], {
      step: 1, back: goChairIntro,
      onPose: (lm, tt) => {
        if (phase === 'count') { if (lm && L.upperVisible(lm)) base.push(L.upperLevel(lm, S.torso)); return; }
        if (phase === 'run') handle(tracker.update(lm, tt));
      },
      tick: (tt) => {
        if (phase === 'count') {
          const n = 3 - Math.floor((tt - countFrom) / 1000);
          if (n > 0) { setText('secs', n); setText('cue', `${t('sitStill')} ${n}`); say(String(n)); return; }
          if (base.length >= 8) tracker.rebaseline(L.median(base.slice(-20)));
          phase = 'run'; tracker.start(tt); demoSet('chair'); say(t('sayGo'));
          return;
        }
        if (phase === 'run') handle(tracker.update(undefined, tt));
      },
    });
    function handle(s) {
      setText('cnt', s.count);
      setText('secs', Math.ceil(s.remainingMs / 1000));
      const ring = el('ring');
      if (ring) ring.setAttribute('stroke-dashoffset', String(C * (s.elapsedMs / tracker.durationMs)));
      setWidth('lvl', s.level);
      setText('cue', !s.seen ? t('whereDidYouGo') : s.armed ? t('standUp') : t('sitDown'));
      setText('hint', !s.seen ? t('cantSeeShoulders') : !s.armsOk ? t('keepArmsCrossed') : '');
      if (!saidMove && s.elapsedMs > 6000 && s.maxLevel < 0.45) { saidMove = true; say(t('sayStandNow')); }
      if (!said15 && s.remainingMs <= 15000) { said15 = true; say(t('say15')); }
      if (!said5 && s.remainingMs <= 5000) { said5 = true; say(t('say5')); }
      if (phase === 'run' && s.unseenMs > 2500 && !s.finished) {
        phase = 'aborted'; tracker.running = false;
        ask({ step: 1, chip: t('chairPaused'), title: t('lostSight'), text: t('chairLostText'), options: [
          { label: () => t('restart30'), onEnter: goChairIntro },
          { label: () => t('adjustSetupAgain'), onEnter: goCalibrateIntro },
          { label: () => t('skipToBalance'), onEnter: () => { S.chairRes = null; startBalance(); } },
        ] });
        return;
      }
      if (s.finished && phase === 'run') {
        phase = 'done';
        S.chairRes = { count: s.count, armsFaults: s.armsFaults };
        say(t('sayTimeUp'));
        later(() => goChairDone(tracker), 1500);
      }
    }
    say(t('sayGetReady'));
    demoSet('sit');
  }

  function goChairDone(tracker) {
    const n = tracker.count, low = n <= 2;
    screen('chairDone', `
      <h2>${t('chairDoneTitle', { n })}</h2>
      <div class="card"><div class="label">${t('chairDoneChart')}</div>${sparkSvg(tracker.history, tracker.up, tracker.durationMs)}</div>
      <p class="muted">${low ? t('chairLow') : t('soundRight')}</p>
      <!--MENU-->`, [
      { label: () => t('yesBalance'), onEnter: startBalance },
      { label: () => t('noRedoChair'), onEnter: goChairIntro },
      { label: () => t('adjustSetupAgain'), onEnter: goCalibrateIntro },
    ], { step: 1 });
    say(t('sayChairDone', { n }) + (low ? ' ' + t('sayChairLow') : ''));
    demoSet('stand');
  }

  function startBalance() {
    S.stagesPassed = 0; S.balanceNote = '';
    goFraming({ needFeet: true, onDone: () => goBalanceIntro(1), onBack: goChairIntro, step: 2 });
  }

  /** Camera check: waits until the needed body parts are in view, then continues by itself. */
  function goFraming({ needFeet, onDone, onBack, step = null, text }) {
    const parts = [[t('head'), [0]], [t('shoulders'), [11, 12]], [t('hips'), [23, 24]]].concat(needFeet ? [[t('feet'), [27, 28]]] : []);
    let okSince = null;
    screen('framing', `
      <div class="split"><div class="col">
        <h2>${t('cameraCheck')}</h2>
        <p class="muted">${text || t('framingText')}</p>
        <ul class="checks" id="checks"></ul>
        <div class="bar"><i id="fbar" style="width:0%"></i></div>
        <!--MENU-->
      </div>${SKEL}</div>`, [
      { label: () => t('continue'), onEnter: onDone },
      { label: () => t('back'), onEnter: onBack },
    ], {
      step, back: onBack,
      tick: (tt) => {
        const lm = poseAgeMs() < 1000 ? S.lm : null;
        const seen = (i) => lm && lm[i] && (lm[i].visibility === undefined || lm[i].visibility >= 0.4) &&
          lm[i].x > -0.02 && lm[i].x < 1.02 && lm[i].y > -0.02 && lm[i].y < 1.02;
        const status = parts.map(([n, idx]) => [n, idx.every(seen)]);
        const html = status.map(([n, ok]) => `<li class="${ok ? 'good' : 'flag'}">${ok ? '✔' : '✖'} ${n}</li>`).join('');
        const c = el('checks'); if (c && c.innerHTML !== html) c.innerHTML = html;
        if (status.every(([, ok]) => ok)) {
          if (okSince === null) okSince = tt;
          setWidth('fbar', (tt - okSince) / 1500);
          if (tt - okSince >= 1500) { say(t('iCanSeeYou')); onDone(); }
        } else { okSince = null; setWidth('fbar', 0); }
      },
    });
    say(t('sayFraming'));
    demoSet('stand');
  }

  function adjustThen(stage) {
    goFraming({ needFeet: true, onDone: () => goBalanceIntro(stage), onBack: () => goBalanceIntro(stage), step: 2 });
  }

  function goBalanceIntro(stage) {
    screen('balIntro', `
      <div class="split"><div class="col">
        <div class="chip">${stage === 1 ? t('balanceTitle') + ': ' : ''}${t('stageOf', { n: stage })}</div>
        <h2>${t(`stage${stage}Name`)}</h2>
        <div class="card"><p>${t(`stage${stage}Say`)}</p><p class="small muted">${t('noCane')}</p></div>
        <!--MENU-->
      </div>${feetSvg(stage)}</div>`, [
      { label: () => t('iAmReady'), onEnter: () => goBalanceRun(stage) },
      { label: () => t('adjustCamera'), onEnter: () => adjustThen(stage) },
      { label: () => t('stopBalance'), onEnter: () => { S.balanceNote = `stopped before stage ${stage}`; goResults(); } },
    ], { step: 2 });
    say(`${stage === 1 ? t('balanceTitle') + '. ' : ''}${t('stageOf', { n: stage })}. ${t(`stage${stage}Say`)} ${t('pressOkReady')}`);
    demoSet('stand');
  }

  function goBalanceRun(stage) {
    const tracker = new L.BalanceStageTracker(stage);
    const side = stage === 2 || stage === 3;
    let ended = false, lastPhase = '';
    screen('balance', `
      <div class="split"><div class="col">
        <div class="chip">${t('stageOf', { n: stage })}: ${t(`stage${stage}Name`)}</div>
        <div class="mid" id="bigtxt">${t('getReady')}</div>
        <div class="bar"><i id="held" style="width:0%"></i></div>
        <p id="msg" class="muted">${t('moveIntoPosition')}</p>
        <div class="hint" id="hint"></div>
      </div>${SKEL}</div>`, [], {
      step: 2,
      onPose: (lm, tt) => handle(tracker.update(lm, tt)),
      tick: (tt) => { if (poseAgeMs() > 800) handle(tracker.update(null, tt)); },
    });
    demoSet('balance', { stage, failAt: stage === 4 ? 5 : undefined });
    const again = (s) => [
      { label: () => t('tryStageAgain'), onEnter: () => goBalanceIntro(stage) },
      { label: () => t('adjustCamera'), onEnter: () => adjustThen(stage) },
      s,
    ];
    function handle(s) {
      if (ended) return;
      setWidth('held', s.heldMs / tracker.holdMs);
      setText('hint', !s.visible ? t('cantSeeWholeBody') : (side && s.view === 'front' && s.phase === 'waiting') ? t('turnSideways') : '');
      if (s.phase === 'waiting') setText('bigtxt', t('getReady'));
      else if (s.phase === 'holding') {
        setText('bigtxt', Math.ceil(s.remainingMs / 1000)); setText('msg', t('holdStill'));
        if (lastPhase !== 'holding') say(t('sayHold'));
      } else if (s.passed) {
        ended = true; S.stagesPassed = stage;
        setText('bigtxt', '✔'); setText('msg', t('wellDone')); say(t('sayHeld'));
        later(() => (stage < 4 ? goBalanceIntro(stage + 1) : goResults()), 2500);
      } else if (s.lost) {
        ended = true;
        ask({ step: 2, chip: t('stageOf', { n: stage }), title: t('lostSight'), text: t('balanceLostText'),
          options: again({ label: () => t('stopBalance'), onEnter: () => { S.balanceNote = `stopped at stage ${stage}`; goResults(); } }) });
      } else if (s.failed && s.kind === 'timeout') {
        ended = true;
        ask({ step: 2, chip: t('stageOf', { n: stage }), title: t('noPositionTitle'), text: t('noPositionText'),
          options: again({ label: () => t('skipRestBalance'), onEnter: () => { S.balanceNote = `skipped at stage ${stage}`; goResults(); } }) });
      } else if (s.failed) {
        ended = true;
        const reason = s.kind === 'moved' ? t('reasonMoved') : stage === 4 ? t('reasonFootDown') : t('reasonLeftPosition');
        ask({ step: 2, chip: t('stageOf', { n: stage }), title: `${reason} ${t('isThatRight')}`, text: t('failConfirmText'), options: [
          { label: () => t('yesRight'), onEnter: () => { S.balanceNote = `stage ${stage}: ${s.kind}`; goResults(); } },
          { label: () => t('noTryAgain'), onEnter: () => goBalanceIntro(stage) },
          { label: () => t('adjustCamera'), onEnter: () => adjustThen(stage) },
        ] });
      }
      lastPhase = s.phase;
    }
    say(t('moveIntoPosition'));
  }

  function goalLines(sum, count) {
    const out = [];
    if (sum.mode === 'clinical') {
      if (count === null) out.push(t('goalChairRedo'));
      else if (sum.chair.below) out.push(t('goalChairBelow', { cut: sum.chair.cutoff, n: count, more: sum.chair.cutoff - count }));
      else out.push(t('goalChairMet', { cut: sum.chair.cutoff }));
    } else out.push(count === null ? t('goalChairRedo') : t('goalChairRef', { n: count, ref: L.YOUNG_REF }));
    const b = S.stagesPassed;
    out.push(b < 3 ? t('goalBalanceBelow', { n: b }) : b === 3 ? t('goalBalanceNext') : t('goalBalanceAll'));
    out.push(t('goalRoutine'));
    if (sum.mode === 'clinical' && sum.flags.length) out.push(t('goalDoctor'));
    return out;
  }

  function goResults() {
    const p = S.profile;
    const count = S.chairRes ? S.chairRes.count : null;
    const sum = L.summarize({ age: p.age, sex: p.sex, chairCount: count, balanceStagesPassed: S.stagesPassed });
    if (!S.savedCheck) {
      S.savedCheck = true;
      p.assessments.push({ at: Date.now(), chairCount: count, stagesPassed: S.stagesPassed, status: sum.status, mode: sum.mode, note: S.balanceNote });
      p.level = X.levelFromSummary(sum);
      saveProfile();
    }
    const clin = sum.mode === 'clinical';
    const cls = { good: 'good', watch: 'flag', talk: 'bad', info: 'muted' }[sum.status];
    const head = t(`status_${sum.status}`);
    const chairLine = count === null ? t('notCompleted')
      : !clin ? t('chairRefLine', { ref: L.YOUNG_REF })
      : sum.chair.below ? t('chairBelowLine', { cut: sum.chair.cutoff }) : t('chairMeetsLine', { cut: sum.chair.cutoff });
    const frac = count === null ? 0 : Math.min(1, count / (clin ? sum.chair.cutoff : L.YOUNG_REF));
    const pips = [1, 2, 3, 4].map((n) => `<i class="${n <= S.stagesPassed ? 'on' : ''}">${n}</i>`).join('');
    const advice = t(`advice_${sum.status}`);
    screen('results', `
      <div class="row" style="justify-content:space-between"><h2>${t('yourResults')}</h2><span class="chip ${sum.status === 'good' ? 'ok' : sum.status === 'info' ? '' : sum.status === 'watch' ? 'warn' : 'bad'}">${head}</span></div>
      <div class="grid2">
        <div class="card"><div class="label">${t('chairTitleShort')}</div>
          <div class="result">${count === null ? '—' : count}</div>
          <div class="meter"><i style="width:${Math.round(frac * 100)}%"></i><b style="left:100%"></b></div>
          <p class="small ${sum.chair.below || count === null ? 'flag' : 'good'}">${chairLine}</p></div>
        <div class="card"><div class="label">${t('balanceTitleShort')}</div>
          <div class="result">${S.stagesPassed}/4</div>
          <div class="pips">${pips}</div>
          <p class="small ${S.stagesPassed >= 3 ? 'good' : clin ? 'flag' : 'muted'}">${S.stagesPassed >= 3 ? t('tandemHeld') : t('tandemNotHeld')}</p></div>
      </div>
      <div class="card"><div class="label">${t('yourGoals')}</div>
        <ul class="goals">${goalLines(sum, count).map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>
      <p class="small ${cls}">${esc(advice)}</p>
      <!--MENU-->`, [
      { label: () => t('seePlan'), onEnter: goPlan },
      { label: () => t('home'), onEnter: goHome },
    ], { step: 3 });
    say(`${head}. ${advice}`);
    demoSet('stand');
  }

  // ---------- daily routine ----------
  const currentPlan = () => X.planFor(S.profile.level || 1);
  const targetText = (it) => X.EXERCISES[it.ex].kind === 'hold' ? t('holdSeconds', { n: it.target }) : t('timesN', { n: it.target });
  const planList = (plan) => `<ol class="plan">${plan.map((it) => `<li><b>${esc(exName(it.ex))}</b><span class="muted">${esc(targetText(it))}</span></li>`).join('')}</ol>`;

  function goPlan() {
    const plan = currentPlan();
    screen('plan', `
      <h2>${t('yourPlan', { level: S.profile.level || 1 })}</h2>
      <div class="card">${planList(plan)}</div>
      <p class="small muted">${t('planNote')}</p>
      <p class="small flag">${t('safetyNote')}</p>
      <!--MENU-->`, [
      { label: () => t('startRoutineNow'), onEnter: goRoutineIntro },
      { label: () => t('home'), onEnter: goHome },
    ], { back: goHome });
    say(t('sayPlan', { n: plan.length }));
  }

  function goRoutineIntro() {
    const plan = currentPlan();
    screen('routineIntro', `
      <h2>${t('todaysRoutine')}</h2>
      <p class="muted">${t('routineMeta', { level: S.profile.level || 1, n: plan.length })}</p>
      <div class="card">${planList(plan)}</div>
      <p class="small flag">${t('safetyNote')}</p>
      <!--MENU-->`, [
      { label: () => t('start'), onEnter: () => { S.session = { at: Date.now(), level: S.profile.level || 1, items: plan.map((i) => ({ ...i, done: 0, completed: false, skipped: false })) }; goExIntro(0); } },
      { label: () => t('home'), onEnter: goHome },
    ], { back: goHome });
    say(t('sayRoutineIntro'));
    demoSet('stand');
  }

  function goExIntro(i) {
    const ses = S.session, it = ses.items[i], ex = X.EXERCISES[it.ex];
    screen('exIntro', `
      <div class="split"><div class="col">
        <div class="chip">${t('exerciseOf', { i: i + 1, n: ses.items.length })}</div>
        <h2>${esc(exName(it.ex))}</h2>
        <div class="card"><p>${t(`how_${it.ex}`)}</p><p class="small muted">${esc(targetText(it))}. ${ex.start === 'sit' ? t('startSitting') : t('startStanding')}</p></div>
        <!--MENU-->
      </div>${ex.start === 'sit' ? CHAIR_FIG : ''}</div>`, [
      { label: () => t('iAmReady'), onEnter: () => goExRun(i) },
      { label: () => t('skipExercise'), onEnter: () => { it.skipped = true; nextEx(i); } },
      { label: () => t('endSession'), onEnter: goSessionDone },
    ], { back: () => sessionMenu(i) });
    say(`${exName(it.ex)}. ${t(`how_${it.ex}`)} ${targetText(it)}. ${t('pressOkReady')}`);
    demoSet(ex.start === 'sit' ? 'sit' : 'stand');
  }

  function sessionMenu(i) {
    ask({ title: t('pausedTitle'), options: [
      { label: () => t('continue'), onEnter: () => goExIntro(i) },
      { label: () => t('skipExercise'), onEnter: () => { S.session.items[i].skipped = true; nextEx(i); } },
      { label: () => t('endSession'), onEnter: goSessionDone },
    ] });
  }
  const nextEx = (i) => (i + 1 < S.session.items.length ? goExIntro(i + 1) : goSessionDone());

  function goExRun(i) {
    const it = S.session.items[i], ex = X.EXERCISES[it.ex];
    const tracker = X.makeTracker(it);
    const isHold = ex.kind === 'hold';
    let ended = false, lastCount = 0, lastPaused = false, lastPhase = '', lastHint = '';
    screen('exRun', `
      <div class="split"><div class="col">
        <div class="chip">${esc(exName(it.ex))}</div>
        <div class="row" style="gap:2rem;align-items:baseline"><div class="big" id="cnt">${isHold ? it.target : 0}</div><div class="mid muted" id="of">${isHold ? t('secondsShort') : '/ ' + it.target}</div></div>
        <div class="bar"><i id="prog" style="width:0%"></i></div>
        <div class="cue" id="cue">${t('getIntoStart')}</div>
        <div class="hint" id="hint"></div>
      </div>${SKEL}</div>`, [], {
      back: () => sessionMenu(i),
      onPose: (lm, tt) => handle(tracker.update(lm, tt)),
      tick: (tt) => { if (poseAgeMs() > 800) handle(tracker.update(null, tt)); },
    });
    demoSet('ex', { id: it.ex });
    say(t('sayGetIntoStart'));
    function handle(s) {
      if (ended) return;
      const pausedMsg = s.needs === 'upper' ? t('pausedUpper') : t('pausedFull');
      if (isHold) {
        setText('cnt', Math.ceil((it.target * 1000 - s.heldMs) / 1000));
        setWidth('prog', s.heldMs / (it.target * 1000));
        setText('cue', s.paused ? t('paused') : s.holding ? t('holdStill') : t('getIntoPosition'));
        setText('hint', s.paused ? pausedMsg : s.hint === 'again' ? t('letsTryAgain') : (it.ex === 'tandemHold' && s.view === 'front' && !s.holding) ? t('turnSideways') : '');
        if (s.holding && lastPhase !== 'holding') say(t('sayHold'));
        if (s.hint === 'again' && lastHint !== 'again') say(t('letsTryAgain'));
        lastPhase = s.holding ? 'holding' : 'waiting'; lastHint = s.hint;
      } else {
        setText('cnt', s.count);
        setWidth('prog', s.count / it.target);
        setText('cue', s.paused ? t('paused') : s.phase === 'baseline' ? t('getIntoStart') : t(`cue_${it.ex}`));
        setText('hint', s.paused ? pausedMsg : s.hint === 'higher' ? t(`higher_${it.ex}`) : '');
        if (s.count !== lastCount && !s.done) say(String(s.count));
        if (s.phase === 'active' && lastPhase === 'baseline') say(t('sayGoEx'));
        if (s.hint === 'higher' && lastHint !== 'higher') say(t(`higher_${it.ex}`));
        lastCount = s.count; lastPhase = s.phase; lastHint = s.hint;
      }
      if (s.paused && !lastPaused) say(pausedMsg);
      lastPaused = s.paused;
      if (s.done) {
        ended = true;
        it.done = isHold ? s.best : s.count;
        it.completed = isHold ? s.success : true;
        setText('cue', it.completed ? t('greatJob') : t('goodEffort'));
        say(it.completed ? t('greatJob') : t('goodEffort'));
        later(() => nextEx(i), 2200);
      }
    }
  }

  function goSessionDone() {
    const ses = S.session, p = S.profile;
    if (ses && !ses.saved) {
      ses.saved = true;
      const doneCount = ses.items.filter((x) => x.completed).length;
      ses.completed = doneCount >= Math.ceil(ses.items.length / 2);
      p.sessions.push({ at: ses.at, level: ses.level, completed: ses.completed, items: ses.items.map(({ ex, target, done, completed, skipped }) => ({ ex, target, done, completed, skipped })) });
      saveProfile();
    }
    const st = X.progressStats(p);
    const doneCount = ses ? ses.items.filter((x) => x.completed).length : 0;
    const msg = ses && ses.completed
      ? (st.sessionsThisWeek >= st.weeklyGoal ? t('weekGoalMet') : t('sessionsLeft', { n: st.weeklyGoal - st.sessionsThisWeek }))
      : t('partialSession');
    screen('sessionDone', `
      <h2>${ses && ses.completed ? t('sessionComplete') : t('sessionEnded')}</h2>
      <div class="grid2">
        <div class="card"><div class="label">${t('exercisesDone')}</div><div class="result">${doneCount}/${ses ? ses.items.length : 0}</div></div>
        <div class="card"><div class="label">${t('thisWeek')}</div><div class="result">${st.sessionsThisWeek}${st.sessionsThisWeek >= st.weeklyGoal ? ' ✓' : ''}</div><p class="small muted">${t('weeklyGoalNote')}</p></div>
      </div>
      <p>${esc(msg)}</p>
      <!--MENU-->`, [
      { label: () => t('myProgress'), onEnter: goProgress },
      { label: () => t('home'), onEnter: goHome },
    ], { back: goHome });
    const ttl = ses && ses.completed ? t('sessionComplete') : t('sessionEnded');
    say(`${/[.!?।]$/.test(ttl) ? ttl : ttl + '.'} ${msg}`);
    if (ses && ses.completed) petals(st.sessionsThisWeek >= st.weeklyGoal ? 90 : 45);
    demoSet('stand');
  }

  // ---------- celebration: a shower of marigold petals when a session is completed ----------
  function petals(n) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas'); c.className = 'petals'; document.body.appendChild(c);
    const W = c.width = innerWidth, H = c.height = innerHeight, g = c.getContext('2d');
    const cols = ['#f5a524', '#ffb92e', '#f08a1c', '#ffd99a'];
    const ps = Array.from({ length: n }, () => ({ x: Math.random() * W, y: -Math.random() * H * 0.6, r: 6 + Math.random() * 10,
      vy: 2 + Math.random() * 3, vx: -1 + Math.random() * 2, a: Math.random() * 6, va: -0.08 + Math.random() * 0.16, col: cols[Math.floor(Math.random() * cols.length)] }));
    const t0 = performance.now();
    (function frame(tt) {
      const age = tt - t0; g.clearRect(0, 0, W, H);
      g.globalAlpha = Math.max(0, Math.min(1, (4200 - age) / 800));
      for (const p of ps) {
        p.x += p.vx + Math.sin((tt / 600) + p.a) * 0.6; p.y += p.vy; p.a += p.va;
        g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.col;
        g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 7); g.fill(); g.restore();
      }
      if (age < 4200) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  // ---------- debug overlay: press D on the keyboard ----------
  document.title = `SteadyTV ${VERSION}`;
  const dbg = document.createElement('pre');
  dbg.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9;margin:0;padding:1.2rem;background:#000e;color:#9f9;font:2rem/1.45 monospace;border-radius:1rem;display:none;max-width:60vw;white-space:pre-wrap';
  document.body.appendChild(dbg);
  document.addEventListener('keydown', (e) => { if (e.key === 'd' || e.key === 'D') dbg.style.display = dbg.style.display === 'none' ? 'block' : 'none'; });
  setInterval(() => {
    if (dbg.style.display === 'none') return;
    const lm = S.lm, f = (i) => (lm && lm[i] ? `vis ${(+lm[i].visibility).toFixed(2)}  y ${lm[i].y.toFixed(2)}` : 'none');
    const n = (v) => (typeof v === 'number' ? v.toFixed(2) : '-');
    const c = S.chair;
    dbg.textContent = [
      `SteadyTV ${VERSION}  screen=${S.screen}  demo=${S.demo}  lang=${S.lang}`,
      `speech: ${NATIVE ? 'Android TTS' : 'browser'}  en=${hasVoice('en')}  hi=${hasVoice('hi')}  audio=${S.audio}`,
      `last pose ${S.lmAt ? Math.round(poseAgeMs()) + ' ms ago' : 'never'}  person=${lm ? 'yes' : 'NO'}  aspect=${n(S.ar)}`,
      `L shoulder ${f(11)}`, `R shoulder ${f(12)}`, `L hip      ${f(23)}`, `L ankle    ${f(27)}`, `R ankle    ${f(28)}`,
      `upper visible ${lm ? L.upperVisible(lm) : false}   full body ${lm ? L.bodyVisible(lm) : false}`,
      `calib stand ${n(S.hStand)}  sit ${n(S.hSit)}  scale ${n(S.torso)}`,
      `chair level ${c ? n(c.level) : '-'}  armed ${c ? c.armed : '-'}  count ${c ? c.count : '-'}`,
    ].join('\n');
  }, 200);

  // ---------- boot ----------
  // Find out whether a home hub (server.js) is behind this page. If not, this is the hosted web version.
  function goSplash() {
    screen('splash', `<div class="splash">${LOGO}<h1>SteadyTV</h1><p class="lead muted">${t('taglineShort')}</p></div>`);
  }
  async function boot() {
    try { window.speechSynthesis && window.speechSynthesis.getVoices(); } catch (_) {}
    try { const l = localStorage.getItem('steadytv-lang'); if (l === 'hi' || l === 'en') S.lang = l; } catch (_) {}
    goSplash();
    const started = now();
    let info = null;
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch('../api/info', { signal: ctl.signal, cache: 'no-store' }); clearTimeout(tm);
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) info = await r.json();
    } catch (_) { info = null; }
    S.hosted = !info;
    if (info) {
      S.lan = info.lan || []; S.httpsPort = info.httpsPort || null;
      const p = await loadProfile('home');
      if (p && p.lang) S.lang = p.lang;
      if (p && typeof p.audio === 'boolean') S.audio = p.audio;
      connectWs();
    } else {
      const p = await loadProfile('home');
      if (p && p.lang) S.lang = p.lang;
    }
    const wait = Math.max(0, 1300 - (now() - started)); // let the bubble settle
    setTimeout(goPair, wait);
  }
  boot();
  window.__steady = S;
})();
