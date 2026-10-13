# Friction log (Build, Ship, Shape hackathon)

Log every snag while building for Fire TV / Android TV. Specific, dated, honest entries earn the bonus.
Format: date · what I tried · what went wrong · how I fixed it · what the docs/tooling should do instead.

- 2026-10-11 · Tried to install the Vega SDK on Windows 11 · SDK supports only macOS and Ubuntu, so no Vega simulator · Used the Android TV emulator (allowed by the official FAQ) with a WebView shell · Docs should state the Windows limitation at the top of the Vega "get started" page.

## 2026-10-13 - No spoken audio in Android TV WebView
- Task: Play spoken instructions in the Android TV emulator.
- Expected: Text-to-speech works as it does in Chrome.
- Actual: The emulator produced no spoken audio.
- Severity: Medium - accessibility feature affected.
- Workaround: Added a native Android TextToSpeech bridge and TTS_SERVICE manifest entry in v0.9.
- Status: Fix implemented; emulator verification pending.
- Suggestion: Document native TTS integration for Android TV WebView apps.
