# Compatibility scope

## DreamSkin packages

This implementation vendors the current upstream Skin API 1 runtime and Safe CSS policy at the commit recorded in UPSTREAM.md. It accepts ordinary ZIP files using the current official manifest format or the current local three-file format. Original CSS, images, and JSON are preserved; Safe CSS is not rewritten into an approximate theme language.

Official packages contain manifest.json, theme.json, non-empty theme.css, exactly one background.jpg/png/webp, and optionally LICENSE.txt or reserved manifest.sig. All paths, file sets, declared byte lengths, SHA-256 hashes, schema fields, capabilities, and minimum runtime version are validated by the upstream validator. Reserved signatures do not establish authenticity and are not verified by the upstream contract.

Linux is absent from the current official manifest platform enum. The adapter validates using one of the package's actual macOS/Windows declarations and preserves it; this is an explicit portability policy, not a claim that its publisher certified Linux. Both platform declarations use the same public parts and Safe CSS policy.

The simplified local ZIP contains exactly non-empty theme.json, non-empty Safe CSS theme.css, and its referenced static JPEG/PNG/WebP. The official validator applies its own looser local theme schema; the Linux payload loader checks renderer fields before use. An archive can have its files at the root or beneath one top-level folder. Import does not change the active theme.

Unsupported package versions, Skin API majors, minimum client versions above 1.5.20, unsafe CSS, image-only ZIPs, missing CSS, .dreamskin extensions, and arbitrary archives fail with errors. Legacy manually placed directory themes without Safe CSS are not admitted through new import. Supporting every historical archive through a bypass would abandon the current safety contract.

The loader uses the exact twelve public parts: root, sidebar, main, header, home, home-hero, project-list, thread, message, composer, composer-toolbar, dialog. The complete registered variables and allowable declaration values are in assets/safe-css-policy.json; this file is upstream's source of truth.

ZIP limits are 32 MiB compressed, 32 entries, and 64 MiB expanded. Images are at most 10 MiB, 16384 pixels per dimension, and 50 million total pixels. Python Pillow fully decodes images and rejects animation before library admission. Link/path attacks, encrypted or ambiguous archives, extra payload files, duplicate filenames, and nested archives are rejected. Files are checked again before every explicit apply. The runtime also revalidates Safe CSS on reload.

## Linux applications

Themes attach to native app:// desktop renderer targets with the Codex shell structure, not ChatGPT websites in embedded browser tabs. A distro package can be accepted for discovery without being visually compatible. The imported ZIP and real UI are independently verified.

Current selector verification provenance is inherited from upstream macOS/Windows evidence, not Linux certification. This machine's archived conversation described Arch chatgpt-bin 26.930.61225-1, but its current CDP endpoint was not available during development. Applying must pass the real renderer checks; a mismatch returns an error and attempts verified recovery.

Native executables and explicit AppImage paths share the same launch path. Debugging flags use a separate profile and loopback binding. Flatpak/Snap wrappers may not preserve those flags or expose their owner process through /proc; if ownership is unconfirmed the launch fails safely. Attach also requires visible Linux socket ownership. Wayland/X11 affect window handling and compositor blur, but theme CSS runs in Chromium in both cases. No display-server override or sandbox disabling is added.

## Feature coverage

Implemented: local import, saved library, native manager, command line, distro/app diagnostics, managed debug launch, explicit existing-session attach, apply and verify, continuous injection on reload, pause, verified switch recovery, managed session restore, private XDG storage, and user desktop installation.

Not implemented: browser one-click dreamskin:// installation, online authoring, theme publishing, system tray integration, automatic engine updates, or image-only theme generation. Those features are separate from local package compatibility.

This is a portable source distribution. A complete-gallery visual certification, signed .deb/.rpm/AppImage builds, native Flatpak/Snap packaging, and multi-distro hardware runs have not been performed. VALIDATION.md records the checks actually completed for this build.
