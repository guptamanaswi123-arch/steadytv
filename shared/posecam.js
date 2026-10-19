// "Use this device's camera": runs MediaPipe pose estimation in the same browser as the TV screen.
// Used by the hosted web version (no computer or phone needed) and by laptops running the TV page.
// Only skeleton points leave this module; the video stays in a hidden <video> element and is never sent anywhere.
const MP_LOCAL = new URL('../vendor/mediapipe/', import.meta.url).href;
const MP_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/';
const MODEL_LOCAL = new URL('../models/pose_landmarker_lite.task', import.meta.url).href;
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

async function exists(url) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

/**
 * @param {{ onPose: (lm: Array<{x:number,y:number,visibility:number}>|null, aspect: number) => void,
 *           onStatus?: (s: 'camera'|'model'|'ready') => void }} opts
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startPoseCamera({ onPose, onStatus = () => {} }) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const e = new Error('This browser cannot open a camera here.'); e.name = 'NoCameraApi'; throw e;
  }
  onStatus('camera');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
  });
  const video = document.createElement('video');
  video.playsInline = true; video.muted = true; video.srcObject = stream;
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  await video.play();

  let stopped = false;
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    video.remove();
  };
  try {
    onStatus('model');
    const base = (await exists(MP_LOCAL + 'vision_bundle.mjs')) ? MP_LOCAL : MP_CDN;
    const { PoseLandmarker, FilesetResolver } = await import(base + 'vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(base + 'wasm');
    const modelAssetPath = (await exists(MODEL_LOCAL)) ? MODEL_LOCAL : MODEL_CDN;
    const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    let landmarker;
    try {
      try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
    } catch (e) {
      const err = new Error((e && e.message) || String(e)); err.name = 'ModelLoadError'; throw err;
    }
    onStatus('ready');

    let last = 0, lastVideoTime = -1;
    const loop = () => {
      if (stopped) return;
      const t = performance.now();
      if (video.currentTime !== lastVideoTime && t - last > 66) { // ~15 per second, like the phone
        last = t; lastVideoTime = video.currentTime;
        const res = landmarker.detectForVideo(video, t);
        const pts = res.landmarks && res.landmarks[0];
        onPose(pts ? pts.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })) : null,
          video.videoWidth / video.videoHeight || 0.75);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (e) { stop(); throw e; }
  return { stop };
}
