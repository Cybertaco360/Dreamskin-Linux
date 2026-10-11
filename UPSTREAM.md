# Upstream attribution

Derived from Fei-Away/Codex-Dream-Skin, MIT license.
Source: https://github.com/Fei-Away/Codex-Dream-Skin
Snapshot: `1c2e8fea9e44e2ce8384bbd1c8759b99397c5d7d`
Runtime compatibility level: 1.5.20 / Skin API 1.

Shared Safe CSS policy, validator, renderer, selector contract and generated CSS are vendored from that snapshot. The injector derives from the Windows Node injector with Linux XDG preference paths. Linux orchestration and package management are new.

The current v1 manifest accepts macos/windows only. The Linux importer validates against one of its actual declarations and preserves the original manifest; it treats that declaration as advisory for this equivalent Skin API runtime, rather than claiming upstream Linux certification. Unknown formats and higher minimum versions fail closed.

Linux-specific injector hardening adds bounded CDP response and theme file reads. Canonical upstream runtime files and Safe CSS policy remain unchanged.
