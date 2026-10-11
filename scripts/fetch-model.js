// Downloads the MediaPipe pose model (about 5 MB) into ./models. Run: npm run fetch-model
const https = require('https');
const fs = require('fs');
const path = require('path');
const URL_ = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const dest = path.join(__dirname, '..', 'models', 'pose_landmarker_lite.task');
fs.mkdirSync(path.dirname(dest), { recursive: true });
if (fs.existsSync(dest) && fs.statSync(dest).size > 1e6) { console.log('Model already downloaded:', dest); process.exit(0); }
function get(url, hops = 0) {
  https.get(url, (res) => {
    if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) return get(res.headers.location, hops + 1);
    if (res.statusCode !== 200) { console.error('Download failed, HTTP ' + res.statusCode); process.exit(1); }
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    res.pipe(out);
    out.on('finish', () => { fs.renameSync(tmp, dest); console.log('Saved', dest, `(${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`); });
  }).on('error', (e) => { console.error('Download failed:', e.message); process.exit(1); });
}
get(URL_);
