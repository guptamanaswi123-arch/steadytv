import { PoseLandmarker, FilesetResolver } from '/vendor/mediapipe/vision_bundle.mjs';

const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const setStatus = (id, cls, text) => { const el = $(id); el.className = cls; el.textContent = text; };
const banner = (t) => { $('banner').textContent = t; };

// ---- room + websocket ----
const params = new URLSearchParams(location.search);
$('room').value = params.get('room') || localStorage.getItem('steadytv-room') || '';
let ws = null, wsOpen = false, room = '';

function connect() {
  room = $('room').value.trim();
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(room)) { banner('Type the code shown on the TV first'); return; }
  try { localStorage.setItem('steadytv-room', room); } catch {}
  if (ws) { ws.onclose = null; ws.close(); }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${room}&role=phone`);
  setStatus('s-tv', 'wait', 'TV: connecting…');
  ws.onopen = () => { wsOpen = true; };
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'peers') setStatus('s-tv', m.tv ? 'ok' : 'wait', m.tv ? 'TV: connected' : 'TV: waiting for the TV page');
    } catch {}
  };
  ws.onclose = () => { wsOpen = false; setStatus('s-tv', 'bad', 'TV: disconnected, retrying…'); setTimeout(connect, 1500); };
}
$('connect').onclick = connect;
$('room').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
if ($('room').value) connect();

// ---- camera ----
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('s-cam', 'bad', 'Camera: blocked. Camera needs https:// or http://localhost');
    throw new Error('no getUserMedia');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  video.srcObject = stream;
  await video.play();
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  setStatus('s-cam', 'ok', `Camera: on (${video.videoWidth}×${video.videoHeight})`);
}

// ---- pose model ----
async function startModel() {
  const head = await fetch('/models/pose_landmarker_lite.task', { method: 'HEAD' });
  if (!head.ok) {
    setStatus('s-model', 'bad', 'Pose model file missing. In the project folder run: npm run fetch-model');
    throw new Error('model missing');
  }
  const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  let lm;
  try { lm = await make('GPU'); } catch { lm = await make('CPU'); }
  setStatus('s-model', 'ok', 'Pose model: ready');
  return lm;
}

function draw(points) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!points) return;
  const W = canvas.width, H = canvas.height;
  ctx.lineWidth = 3; ctx.strokeStyle = '#60a5fa';
  for (const c of PoseLandmarker.POSE_CONNECTIONS) {
    const a = points[c.start], b = points[c.end];
    if (!a || !b || a.visibility < 0.4 || b.visibility < 0.4) continue;
    ctx.beginPath(); ctx.moveTo(a.x * W, a.y * H); ctx.lineTo(b.x * W, b.y * H); ctx.stroke();
  }
  ctx.fillStyle = '#34d399';
  for (const p of points) if (p.visibility >= 0.4) { ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 4, 0, 7); ctx.fill(); }
}

async function main() {
  try { await startCamera(); } catch (e) {
    if (e.name === 'NotAllowedError') setStatus('s-cam', 'bad', 'Camera: permission denied. Click the camera icon in the address bar and allow it.');
    else if (e.name === 'NotFoundError') setStatus('s-cam', 'bad', 'Camera: no camera found');
    else if (!/getUserMedia/.test(e.message)) setStatus('s-cam', 'bad', 'Camera error: ' + e.message);
    banner('Camera not ready'); return;
  }
  let landmarker;
  try { landmarker = await startModel(); } catch (e) {
    if (!/model missing/.test(e.message)) setStatus('s-model', 'bad', 'Model error: ' + e.message);
    banner('Pose model not ready'); return;
  }
  banner('Looking for you…');
  let lastSent = 0, lastVideoTime = -1;
  const loop = () => {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const now = performance.now();
      const res = landmarker.detectForVideo(video, now);
      const pts = res.landmarks && res.landmarks[0];
      draw(pts);
      banner(pts ? 'Tracking ✔' : 'I can’t see you. Step back so your whole body is in view.');
      if (wsOpen && now - lastSent > 66) { // ~15 Hz
        lastSent = now;
        const lm = pts ? pts.map((p) => [+p.x.toFixed(4), +p.y.toFixed(4), +(p.visibility ?? 1).toFixed(2)]) : null;
        ws.send(JSON.stringify({ type: 'pose', lm, ar: +(video.videoWidth / video.videoHeight).toFixed(3) }));
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
main();
