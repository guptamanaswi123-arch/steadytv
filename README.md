# SteadyTV

Fall-risk screening for older adults, in the living room, on Fire TV. Based on the CDC STEADI tests
(30-Second Chair Stand and 4-Stage Balance). A phone or laptop camera runs on-device pose estimation
(MediaPipe); the TV shows large, voice-guided steps and the results; a family member can open a report link.
**No video ever leaves the device**, only skeleton coordinates. Screening aid, not a medical diagnosis.

## What it does
- **Weekly check:** CDC STEADI 30-Second Chair Stand (age- and sex-specific cut-offs, 60+) and 4-Stage Balance Test (side view for half-step and heel-to-toe). It asks before ending a test if it loses sight of you.
- **Daily routine:** a 10-minute plan of Otago-style home strength and balance moves, chosen from the weekly check. Live rep counting and hold timers; it pauses when you leave the frame and gives simple prompts such as "lift a little higher".
- **Progress:** sessions this week (goal: 3), weeks meeting the goal, and the chair-stand trend across checks. Presented as motivation, not as a clinical claim.
- **Family report:** `http://<computer-ip>:3000/family/home` shows a weekly summary.
- **Accessible TV design:** large text, spoken prompts with captions, D-pad focus, audio on/off, English and Hindi.
- **Privacy:** video stays on the camera device; only skeleton coordinates travel. Progress is stored as a JSON file in `data/` on your own computer.

## Run it
```
npm install
npm run fetch-model     # downloads the ~5 MB pose model once
npm start
```
- TV screen in a browser: http://localhost:3000/tv  (pick "Try demo mode" to run without a camera)
- Camera page: http://localhost:3000/phone?room=CODE  (use the code shown on the TV)
- Fire TV / Android TV emulator: build the app in `android/` (a WebView shell that loads http://10.0.2.2:3000/tv)
- Tests: `npm test`

## Architecture
```
 camera device (phone/laptop)             Node relay (server.js)              TV (WebView on Fire OS)
 MediaPipe PoseLandmarker  --landmarks-->   WebSocket rooms   --landmarks-->  shared/logic.js tests + UI
 (video stays here)                         /report/<room> family page        speech prompts, D-pad
```
`shared/logic.js` has all test logic (chair-stand counter, balance-stage tracker, CDC cutoffs) and a
synthetic skeleton generator used for the unit tests and for demo mode.

## Phone camera over Wi-Fi
Browsers only allow camera access on `localhost` or HTTPS. `npm start` therefore also starts a self-signed HTTPS
server on port 3443. On a phone on the same Wi-Fi, open the `https://<computer-ip>:3443/phone?room=CODE` link shown on the
TV screen and accept the browser's one-time security warning (the certificate is generated on your own computer).
If your network blocks that, a tunnel such as `cloudflared tunnel --url http://localhost:3000` also works.

## Limits (honest)
Front-camera heuristics approximate foot positions for balance stages 2-3. Use as a screening aid with a helper nearby.

License: MIT
