# Linux distribution evaluation

The loader uses Node's built-in WebSocket, Python's standard ZIP reader plus Pillow, and optional PyQt6 or PyQt5. It does not depend on a specific init system, desktop environment, package manager, or display server. It stores files through XDG conventions and installs for one user without root. No distribution-wide changes are performed automatically.

| Family | Dependency route | App and caveat | Evidence |
|---|---|---|---|
| Arch / Manjaro / EndeavourOS | `nodejs`, `python`, `python-pillow`, `python-pyqt6` (or `python-pyqt5`) through pacman | Recognizes chatgpt-bin's `/usr/lib/chatgpt/ChatGPT` and launcher. Prefer direct binary if a wrapper loses debug flags. | Development host is Arch; previous backend checks and PyQt5 offscreen window capture run here. Real app render is a separate check. |
| Debian / Ubuntu / Mint / Pop | `python3`, `python3-pil`, `python3-pyqt6` (or `python3-pyqt5`) through apt; Node 22+ | Native desktop build or AppImage required. Stock Node on older stable releases can be too old. | Detection/compatibility logic implemented; no native distro run. |
| Fedora / RHEL / Rocky / Alma | `python3`, `python3-pillow`, PyQt binding for the selected interpreter (Fedora: `python3-pyqt6`); supported `nodejs` stream | Native RPM/application or AppImage required. SELinux remains enabled. A policy refusing `/proc` access or debugging produces a diagnostic failure. | Detection/compatibility logic implemented; no native distro run. |
| openSUSE | Suitable `nodejs22` or newer, Pillow and PyQt6/PyQt5 for the selected Python stream | Package names vary by Python stream. No assumptions about the app's install prefix. | Detection/compatibility logic implemented; no native distro run. |
| NixOS | Node 22+ and Python environment with pillow and pyqt6 (or pyqt5) | Set `DREAMSKIN_PYTHON` and `DREAMSKIN_GUI_PYTHON`; immutable paths are handled via explicit executables. App packaging and `/proc` ownership must work. | Environment overrides implemented; no NixOS run. |
| Alpine / other musl systems | Compatible Node/Python dependencies | A glibc-only desktop binary requires separate application packaging. The loader cannot solve that binary ABI mismatch. | Not certified. |

Use `node bin/dreamskin.mjs doctor` to inspect the actual host, runtime versions, Python modules, session type, and discovered apps. Suggestions do not install packages or claim that the host already satisfies them. Verify package availability/version with your distro's package manager.

## Packaging matters more than distro names

Native executables and executable AppImages are supported by the launch implementation. Discovery checks known paths and the current PATH; an arbitrary install prefix can be selected explicitly. AppImage mount behavior can change PID or process command identity. If identity cannot be proven, managed launch fails and records recovery state rather than claiming success. You can attach to a separately launched app when the endpoint owner is verifiable.

Flatpak and Snap are conditional. A wrapper may not forward Chromium flags, its sandbox can hide `/proc` ownership, or it may require its own supported launch interface. The loader does not install overrides, disable confinement, or invent an app ID. Existing wrapper commands can be supplied with `--app` and repeatable `--app-arg`; they still must pass ownership and renderer checks. Neither packaging format is certified by this build.

Wayland and X11 use the same renderer. The PyQt manager can use native Wayland, X11, or XWayland through the appropriate installed Qt platform plugin. A binding alone does not guarantee the plugin and its shared libraries are installed. If Qt reports a platform-plugin error, install the distro plugin package matching that Qt version; the command line remains available. Native Wayland and PyQt6 have not been exercised on the development host for this revision. The current display environment is preserved and the loader never adds `--no-sandbox`, forces X11, changes SELinux/AppArmor policy, or disables GPU acceleration. Compositor-level transparency and title bars can differ from CSS inside the window. Chromium must support the CSS used by the upstream runtime, including relative colors and modern selectors.

## Lifecycle differences

Separate-profile mode starts a distinct managed profile. Original-profile mode uses the app's default data and requires quitting its usual window first; the loader does not terminate it automatically. Some single-instance application wrappers may still refuse a separate profile; they will return a launch diagnostic. No process is terminated by name. Restore can stop only the same UID, PID, start time, and executable/debug-port identity recorded at launch, with an additional exact profile check for separate-profile launches. Attached debug sessions remain the user's responsibility to quit normally.

Process ownership uses Linux `/proc/net/tcp*`, `/proc/PID/fd`, and `/proc/PID/stat`. On restricted containers, hardened desktops, or sandboxes where these records are inaccessible, attachment fails. Shared inherited descriptors are accepted only within one verified process tree; unrelated owners are rejected. This is an intentional identity check, not an unsupported claim of broad sandbox compatibility.

Dependency naming sources: [Arch PyQt6](https://archlinux.org/packages/extra/x86_64/python-pyqt6/), [Debian PyQt6](https://packages.debian.org/sid/python3-pyqt6), [Fedora PyQt6](https://packages.fedoraproject.org/pkgs/python-pyqt6/python3-pyqt6/), and [Fedora Pillow](https://packages.fedoraproject.org/pkgs/python-pillow/python3-pillow/). Package availability and names vary by release. The openSUSE and NixOS rows describe environment requirements to check on the installed host.
