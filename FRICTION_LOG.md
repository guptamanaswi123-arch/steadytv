# Friction log (Build, Ship, Shape hackathon)

Log every snag while building for Fire TV / Android TV. Specific, dated, honest entries earn the bonus.
Format: date · what I tried · what went wrong · how I fixed it · what the docs/tooling should do instead.

- 2026-10-11 · Tried to install the Vega SDK on Windows 11 · SDK supports only macOS and Ubuntu, so no Vega simulator · Used the Android TV emulator (allowed by the official FAQ) with a WebView shell · Docs should state the Windows limitation at the top of the Vega "get started" page.

## 2026-10-19 - Android TV WebView requires a local server
- Task: Make SteadyTV accessible to reviewers without my computer.
- Expected: The Android TV app should work without a developer-hosted server.
- Actual: The WebView depended on a local Node.js server at 10.0.2.2, which is not accessible on real Fire TV devices.
- Severity: Medium - reviewers could not easily test the application.
- Workaround: Added a static GitHub Pages version and a 1.5-second Android WebView fallback to the hosted site.
- Status: Implemented in v1.0; hosted deployment and device fallback require verification.
- Suggestion: Provide official Fire TV documentation for hybrid WebView applications with hosted fallback.
