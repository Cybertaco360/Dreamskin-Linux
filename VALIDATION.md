# Validation record — 2026-10-10

Development host: Arch Linux x64, Node 26.10.0, /usr/bin/python3 3.14.7 with Pillow 12.3.0 and PyQt5 5.15.11 / Qt 5.15.18. Native desktop session reported Wayland.

- 29 Linux Node checks passed: official/simple/wrapped import, duplicate identity, malformed ZIP rejection, hash/minimum-version/Safe CSS rejection, saved-library isolation, revalidation after corruption, distro parsing, launch-argument safety, private state, lock serialization, bounded endpoints, process identities, and closed/live debug-port recovery.
- 4 installer checks passed: install/update preserving data, selected data root in both launcher formats, rollback after desktop write failure, foreign launcher refusal, and symlinked parent refusal (some assertions share one check).
- Upstream Safe CSS and renderer runtime suites passed. Upstream official package contract suite passed on both declared platforms; its macOS shell integration was skipped because this host is Linux.
- Linux injector loopback/CDP validation self-test passed.
- Version 0.1.0 used Tkinter. Version 0.1.1 replaces it with PyQt. The PyQt5 window was captured using Qt's offscreen platform with a temporary demo collection and original generated preview artwork. The GUI called the real CLI to load status and the collection. This is a visual inspection, not a live ChatGPT skin check. An attempted Xvfb capture aborted before the window opened; native display-plugin operation and PyQt6 remain unverified for this revision.
- Automated backend and installer checks above were recorded for 0.1.0; they were not rerun for the GUI revision. No new automated GUI tests were run.
- The attached yuansheng-0.1.0.zip imported as official format and was fully revalidated. All declared payload hashes matched. Its JPEG fully decoded at 1024 × 1024. Safe CSS was validated and the assembled 1,121,163-byte renderer payload passed compilation. The original archive and artwork are not redistributed in this source package.

No existing debugging listener was available at 127.0.0.1:9222. Live theme application and managed launch against the user's authenticated ChatGPT app were not performed. There is no complete-gallery visual test, Debian/Fedora/openSUSE/NixOS hardware run, Flatpak/Snap certification, or native Linux binary installer build.

Use doctor to check this host, attach or launch explicitly, keep the app window visible, then Apply and Verify. Success is reported only when the actual renderer passes the runtime's visibility, structure, theme identity, stylesheet, and layout checks.


## 0.1.2 connection repair — 2026-10-11

The reported failure was reproduced against the existing installed session on the actual host, outside the coding tool's restricted process/network namespace. The app's endpoint answered at 127.0.0.1:44517. Its main PID 15252 and three descendant helper PIDs held the same listening socket. The old check rejected the four holders. The main process also presented all arguments in a single rewritten process-title string, which the old exact argv-entry check did not handle.

The revised read-only check accepted the same main PID/start-time pair, executable and loopback socket, while accounting for the three descendant holders. Literal port/profile switch matching works on the observed title. Native app ownership is still checked; this does not grant access through inaccessible /proc data. The tool sandbox cannot see the host app unless the command runs on the host.

The new CLI's reconnect command then succeeded against that existing session and saved its verified browser/owner identity. It reported connected=true, profileMode=separate, inheritedSocketHolders=3. No new app was spawned and no app was stopped. This also exercised the rewritten-command-line profile check, private control lock and legacy-state migration path on the actual host.

Usual-profile launch omits --user-data-dir; it never copies or alters an existing app profile to create a themed sign-in. A cold launch of the user's original profile has not been attempted, to avoid closing or colliding with their running app. No theme was applied during diagnosis. Automated checks from the earlier version have not been rerun for this revision.
