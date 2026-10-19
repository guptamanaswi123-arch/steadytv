# SteadyTV

**Strength and balance at home, guided by your TV.** SteadyTV turns the CDC STEADI fall-risk checks
(30-Second Chair Stand and 4-Stage Balance) into a weekly check plus a 10-minute daily routine of
Otago-style exercises, for older adults on Fire TV / Android TV. A phone acts as the camera and runs
on-device pose estimation (MediaPipe); the TV shows large, spoken, remote-friendly steps.
**No video ever leaves the camera device**, only body points (numbers). A screening and exercise aid, not a medical diagnosis.

## Try it now (no install)
**Web version:** https://guptamanaswi123-arch.github.io/steadytv/
Choose **Try demo mode** to run every screen with sample data, or **Use this device's camera** to do the
real check with your laptop or phone camera (pose tracking runs in your browser). Arrow keys + Enter act as the TV remote.

## What it does
- **Weekly check:** CDC STEADI 30-Second Chair Stand (age- and sex-specific cut-offs for 60+) and 4-Stage Balance Test
  (side view for half step and heel-to-toe). It asks before ending a test if it loses sight of you.
- **Daily routine:** Otago-style strength and balance moves chosen from the weekly check, with live rep counting,
  hold timers, a pause when you leave the frame, and simple prompts such as "lift a little higher".
- **Progress:** sessions this week (goal: 3), weeks meeting the goal, and the chair-stand trend. Motivation, not a clinical claim.
- **Multi-modal control:** TV remote (D-pad), voice commands through the phone's microphone (English and Hindi), spoken prompts with captions.
- **Accessible TV design:** Atkinson Hyperlegible type (designed for low-vision readers), high-contrast focus, audio on/off, English and Hindi.
- **Family report:** with the home hub running, `http://<computer-ip>:3000/family/home` shows a weekly summary.
- **Privacy:** video stays on the camera device. Progress is a JSON file on your own computer (or in your browser for the web version).

## Three ways to run it
| | What you need | What works |
|---|---|---|
| **Web version** (link above) | Any browser | Demo mode, this-device camera, progress saved in the browser |
| **Fire TV / Android TV app** (`android/`) | The APK on a TV or emulator | Opens the home hub if it finds one, otherwise the web version |
| **Home hub** (`npm start`) | A computer on the home Wi-Fi | Everything: phone camera pairing by QR code, voice commands, family report |

### Home hub
```
npm install
npm run fetch-model     # downloads the ~5 MB pose model once
npm start
```
- TV screen in a browser: http://localhost:3000/tv/
- Fire TV / Android TV emulator: build `android-app/` (or paste `android/MainActivity.kt` and `android/AndroidManifest.xml`
  into a new Android Studio "Empty Views Activity" project, package `com.steadytv.app`). The emulator reaches the hub at http://10.0.2.2:3000/tv/.
- Phone camera: scan the QR code on the TV (same Wi-Fi). It opens `https://<computer-ip>:3443/phone/?room=CODE`;
  accept the one-time warning for the certificate that your own computer generated. Browsers only allow cameras on HTTPS pages.
- Tests: `npm test`

### Publishing the web version
`.github/workflows/pages.yml` runs the tests, downloads the pose model, builds `site/` with `npm run build-static`
and publishes it to GitHub Pages on every push to `main` (repo Settings, Pages, Source: GitHub Actions).

## Architecture
```
 phone (camera + mic)                    home hub (server.js)               TV (Fire OS WebView shell)
 MediaPipe PoseLandmarker --points-->    WebSocket rooms     --points-->    shared/logic.js + shared/exercises.js
 speech recognition       --commands-->  profiles (JSON)                    UI, D-pad, Android text-to-speech
 (video stays here)                      family report page

 web version: the TV page runs MediaPipe itself (shared/posecam.js) and keeps progress in the browser.
```
`shared/logic.js` holds the test logic (chair-stand counter, balance-stage tracker, CDC cut-offs);
`shared/exercises.js` the routine (rep counters, holds, plans, progress); `shared/voice.js` the voice-command parser.
All three are unit-tested, and a synthetic skeleton generator drives the tests and demo mode.

## Limits (honest)
Camera heuristics approximate foot positions for balance stages 2 and 3; the side view helps. Use with a helper nearby.
Voice commands use the browser's speech recognition, which needs internet on Chrome for Android.

## Credits
Fonts: Atkinson Hyperlegible (Braille Institute) and Hind (Indian Type Foundry), SIL Open Font License, in `tv/fonts/`.
Pose model: MediaPipe Pose Landmarker (Google, Apache 2.0). QR codes: qrcode-generator (MIT).

License: MIT
