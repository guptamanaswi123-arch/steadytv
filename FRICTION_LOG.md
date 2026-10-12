# Friction log (Build, Ship, Shape hackathon)

Log every snag while building for Fire TV / Android TV. Specific, dated, honest entries earn the bonus.
Format: date · what I tried · what went wrong · how I fixed it · what the docs/tooling should do instead.

- 2026-10-11 · Tried to install the Vega SDK on Windows 11 · SDK supports only macOS and Ubuntu, so no Vega simulator · Used the Android TV emulator (allowed by the official FAQ) with a WebView shell · Docs should state the Windows limitation at the top of the Vega "get started" page.

## 2026-10-12 - Phone camera HTTPS connection issue
- **Task:** Connect the phone camera to SteadyTV running on the Android TV emulator.
- **Expected:** Phone connects securely and sends pose data to the TV.
- **Actual:** Cloudflare tunnel timed out repeatedly, preventing the phone connection.
- **Workaround:** Used the built-in local HTTPS server on the same Wi-Fi network.
- **Result:** Phone camera successfully connected to SteadyTV.
- **Suggestion:** Provide clearer documentation for secure companion-phone camera connections during Fire TV development.
