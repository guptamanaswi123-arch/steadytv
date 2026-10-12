# Friction log (Build, Ship, Shape hackathon)

Log every snag while building for Fire TV / Android TV. Specific, dated, honest entries earn the bonus.
Format: date · what I tried · what went wrong · how I fixed it · what the docs/tooling should do instead.

- 2026-10-11 · Tried to install the Vega SDK on Windows 11 · SDK supports only macOS and Ubuntu, so no Vega simulator · Used the Android TV emulator (allowed by the official FAQ) with a WebView shell · Docs should state the Windows limitation at the top of the Vega "get started" page.
## 2026-10-12 - Android Studio could not download Gradle (blocked first build)
- **Task:** Create the Android project for the Fire TV / Android TV shell app and run the first Gradle sync.
- **Steps:** New project in Android Studio, wait for Gradle sync. Retried three times, switched Wi-Fi, set networkTimeout=300000 in gradle-wrapper.properties.
- **Expected:** Gradle (gradle-9.6.0-bin.zip, ~134 MB) downloads in a minute or two and sync succeeds.
- **Actual:** "Could not install Gradle distribution ... java.net.SocketTimeoutException: Read timed out". Browser download of the same file estimated about 2 hours on my connection.
- **Severity:** High. The first build is a hard blocker, with no clear error pointing to a fix.
- **Workaround:** Downloaded the zip manually (resumable download in the browser), put it in C:\gradle, and changed distributionUrl in gradle/wrapper/gradle-wrapper.properties to file:///C:/gradle/gradle-9.6.0-bin.zip. Build then succeeded in 4m 16s.
- **Suggestion:** Android Studio should show the exact file URL and size on timeout and offer "Download manually / choose a local Gradle distribution" in the error. The Fire TV getting-started guide should mention this workaround for slow networks.
