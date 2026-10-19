// Builds the "no computer needed" version of SteadyTV into ./site for static hosting (GitHub Pages).
// It contains the TV app (demo mode + "use this device's camera"), the shared logic, MediaPipe and the pose model.
// Phone pairing and the family report need the local server, so they are not part of this build.
// Run: npm run build-static   (the GitHub Actions workflow runs it automatically)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'site');

function copy(src, dest, filter = () => true) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) if (filter(f)) copy(path.join(src, f), path.join(dest, f), filter);
  } else fs.copyFileSync(src, dest);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

copy(path.join(ROOT, 'tv'), path.join(OUT, 'tv'));
copy(path.join(ROOT, 'shared'), path.join(OUT, 'shared'));

const mp = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision');
fs.mkdirSync(path.join(OUT, 'vendor', 'mediapipe'), { recursive: true });
copy(path.join(mp, 'vision_bundle.mjs'), path.join(OUT, 'vendor', 'mediapipe', 'vision_bundle.mjs'));
copy(path.join(mp, 'wasm'), path.join(OUT, 'vendor', 'mediapipe', 'wasm'));

const qr = path.join(ROOT, 'node_modules', 'qrcode-generator', 'dist', 'qrcode.js');
fs.mkdirSync(path.join(OUT, 'vendor', 'qrcode'), { recursive: true });
copy(qr, path.join(OUT, 'vendor', 'qrcode', 'qrcode.js'));

const model = path.join(ROOT, 'models', 'pose_landmarker_lite.task');
fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });
if (fs.existsSync(model)) copy(model, path.join(OUT, 'models', 'pose_landmarker_lite.task'));
else console.warn('Pose model not found locally; the web app will download it from Google when needed.');

fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=tv/"><title>SteadyTV</title>
<a href="tv/">Open SteadyTV</a>`);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

let files = 0, bytes = 0;
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) walk(p); else { files++; bytes += s.size; } } })(OUT);
console.log(`Static site ready in ./site (${files} files, ${(bytes / 1e6).toFixed(1)} MB)`);
