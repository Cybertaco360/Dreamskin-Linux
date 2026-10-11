# DreamSkin Linux

A Linux theme manager for the ChatGPT/Codex desktop shell, using DreamSkin's MIT-licensed Skin API 1 renderer and exact Safe CSS policy. Version 0.1.2 is a local implementation, not an upstream release or a certified port.

## Start

Install Node.js 22 or newer, Python 3, and Pillow. The native manager uses PyQt6, with PyQt5 as a fallback. Install one binding for the Python interpreter that launches the manager. See DISTROS.md for package-manager differences. There are no npm dependencies.

From this folder:

```sh
node bin/dreamskin.mjs doctor
node bin/dreamskin.mjs gui
```

Optional user installation (no sudo):

```sh
/usr/bin/python3 install.py
```

The installed application appears in the application menu. The `dreamskin` launcher is written to `~/.local/bin`; use its full path if that directory is absent from PATH. Themes are retained across engine updates.

In the manager, import an ordinary DreamSkin ZIP. Import validates and saves it without switching the app. Choose a theme in the collection, then use **Connect app** to open a detected app or select its executable. The connection dialog and the **•••** menu also offer attachment to an app already running with local debugging. Click **Apply theme** once connected. You can drag a local ZIP onto the window or use **Import theme** (Ctrl+O).

The connection dialog offers **Use my usual profile** (its default) and **Use a separate profile**. Usual profile uses the app's normal sign-in and history: save work and quit the usual app first, then open it through DreamSkin. Separate profile keeps an isolated sign-in and may ask you to log in. The CLI keeps separate profile as its default unless you pass `--profile original`. The renderer must be visible for application verification. Theme changes are verified before the saved session is updated, and a failed switch attempts verified recovery.

## Launching and recovering a connection

The loader requires a local Chromium debugging connection (CDP). The DevTools window does not need to be open, and a separate profile is optional. This is not a release build versus debug build distinction: the normal packaged app is started with a debugging flag. A running app that started without that flag must be quit and relaunched. DreamSkin does not automatically close a pre-existing app, patch its files, copy credentials, or change its launcher permanently.

To use the usual app profile:

```sh
node bin/dreamskin.mjs launch --app /usr/lib/chatgpt/ChatGPT --profile original
```

Select your actual app executable if installed elsewhere. The manager offers the same profile choice. Restore closes only the particular app process DreamSkin launched, including an original-profile launch; your usual data is retained. Restarting from the ordinary launcher leaves debugging off unless you separately configured it there. Desktop-app updates and custom wrappers can alter how profile settings are handled, so the original-profile mode uses the app's own default rather than guessing or rewriting its configuration.

If an earlier attempt opened a window but reported that its endpoint could not be verified, use **Retry connection** or:

```sh
node bin/dreamskin.mjs reconnect
```

Version 0.1.2 fixes two issues observed with the user's Arch ChatGPT build: child processes inherit the browser's listening socket, and Electron rewrites the visible command line into a single string. Ownership now checks that all readable socket holders belong to one process tree, selects its actual app process, and rechecks the listening inodes. Literal switch matching supports both argument arrays and flattened process titles. Unrelated holders, non-loopback listeners, changed PID/start-time pairs, and unreadable ownership still fail. A failed connection refreshes the GUI so Retry and Restore are available; Apply stays disabled until the connection is recorded.

A wrapper that launches another process and exits cannot always be attributed safely to the recorded PID. Choose the direct desktop executable when this happens. Genuine sandbox restrictions receive an explicit diagnostic; this fix does not bypass them.

## Manager interface

The window has a local theme collection, an artwork/color preview, and an app connection card. Apply and Pause are next to the selected theme. Restore is beside the connection status; verification, system details, refresh, and attachment settings are in the **•••** menu. Commands run asynchronously so the window remains responsive. Closing is deferred while an operation is running.

The preview is an illustration built from local artwork, colors, and image focus. It does not execute theme CSS or reproduce the live app layout. Import and Apply still use the full package and renderer validation. Preview images are size limited, and paths outside the selected theme are refused.

If no distro binding is available, use a dedicated virtual environment and its Python as `DREAMSKIN_GUI_PYTHON`; `requirements-gui.txt` lists the PyQt6 option. The CLI does not need Qt. Qt chooses its installed Wayland or X11 platform plugin; the manager does not force a display server.

## Command line

```sh
node bin/dreamskin.mjs import /path/to/theme.zip
node bin/dreamskin.mjs list
node bin/dreamskin.mjs launch --app /usr/lib/chatgpt/ChatGPT
node bin/dreamskin.mjs apply THEME_KEY_FROM_LIST
node bin/dreamskin.mjs verify
node bin/dreamskin.mjs pause
node bin/dreamskin.mjs restore
```

For an existing debug session:

```sh
node bin/dreamskin.mjs attach --port 9222
node bin/dreamskin.mjs apply THEME_KEY_FROM_LIST
```

The listener must be loopback-only, belong to this user, and be owned by a recognized ChatGPT/Codex executable. The browser identity is pinned to prevent reconnecting to a different process after the app exits. Unrelated browser tabs, embedded websites, iframe content, and pet surfaces are excluded by the upstream target and DOM checks.

**Pause** removes and verifies the theme, and stops its watcher. The app's debug port stays open. **Restore** also closes a managed app that this loader launched. Save work before restoring. For an attached app, Restore removes the skin but leaves that external process alone: quit it and reopen it normally to close debugging. No automatic process-name killing, binary patching, sudo, or sandbox-disabling flags are used.

## Storage and offline use

The default data root is `$XDG_DATA_HOME/dreamskin-linux`, falling back to `~/.local/share/dreamskin-linux`. It holds saved themes, private verified snapshots, session state, logs, preferences, and separate managed app profiles. `DREAMSKIN_DATA_HOME` can select a different absolute data root. Imported themes and runtime operate offline; the desktop app itself still uses its usual services.

`DREAMSKIN_PYTHON` selects the Python interpreter for archive/image validation. The importer probes Python with Pillow, including `/usr/bin/python3`. `DREAMSKIN_GUI_PYTHON` selects the PyQt interpreter, defaulting to `/usr/bin/python3`.

## Compatibility and limits

See COMPATIBILITY.md for supported theme formats and the exact upstream snapshot. Package acceptance and visual compatibility are separate checks: Linux builds exposing a different DOM can be rejected even when the ZIP is valid. This implementation does not claim that every gallery theme has been visually tested on every Linux distribution.

The manager supports local ZIP import, saved themes, switching, continuous reload injection, pause, restore, verification, diagnostics, and desktop integration. Online one-click URI installation, a theme authoring studio, image-only theme creation, and system tray integration are not implemented in this version.

For recovery after an interrupted session, run Restore. If the app does not respond, quit its managed debug window normally, then run Restore again. Managed profiles are preserved so sign-in is not deleted during recovery. The app port is unauthenticated to other processes on the same computer; close the debug session with Restore when finished.

## Development checks

```sh
node --test tests/*.test.mjs
node scripts/injector.mjs --self-test
/usr/bin/python3 tests/install_test.py
```

The 0.1.2 launch changes were checked against the already-running debug app without applying a theme or stopping it. A fresh usual-profile launch and live theme appearance were not exercised in this revision.

UPSTREAM.md and LICENSE preserve attribution for the vendored DreamSkin code. Theme artwork is not bundled.

PyQt and Qt are external dependencies with their own licenses. See [PyQt licensing](https://www.riverbankcomputing.com/software/pyqt/intro) and [Qt licensing](https://www.qt.io/licensing/). They are not bundled in this source archive.
