#!/usr/bin/env bash
# Personal local workflow; no sudo, package installation or compositor edits.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
DATA=${XDG_DATA_HOME:-${HOME:?}/.local/share}
BIN=${MARKRUST_BIN_DIR:-$HOME/.local/bin}
DESKTOP="$DATA/applications/com.markrust.app.desktop"
ICON="$DATA/icons/hicolor/128x128/apps/com.markrust.app.png"
EXE="$BIN/markrust"
BUILD="$ROOT/target/release/markrust"
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
for path in "$DATA" "$BIN"; do
  [[ "$path" == /* && "$path" != *$'\n'* && "$path" != *$'\r'* ]] || fail 'Installation paths must be absolute and contain no newlines.'
done
managed() { [[ -f "$DESKTOP" ]] && grep -qx 'X-MarkRust-Managed=true' "$DESKTOP"; }
refresh() {
  if command -v update-desktop-database >/dev/null; then update-desktop-database "$DATA/applications" || true; fi
}
case "${1:-help}" in
  doctor)
    missing=0
    printf 'MarkRust environment (no changes made)\n'
    printf 'Session: %s; desktop: %s; Wayland display: %s\n' "${XDG_SESSION_TYPE:-unset}" "${XDG_CURRENT_DESKTOP:-unset}" "${WAYLAND_DISPLAY:-unset}"
    [[ -f /etc/arch-release ]] || printf 'NOTE: This machine is not detected as Arch Linux.\n'
    [[ -n "${WAYLAND_DISPLAY:-}" ]] || printf 'NOTE: Run the native GUI test inside your Hyprland session.\n'
    for cmd in cargo rustc cc pkg-config; do
      if command -v "$cmd" >/dev/null; then "$cmd" --version | head -n 1; else printf 'MISSING: %s\n' "$cmd"; missing=1; fi
    done
    if command -v pkg-config >/dev/null; then
      for lib in webkit2gtk-4.1 gtk+-3.0 libsoup-3.0 openssl; do
        if pkg-config --exists "$lib"; then printf '%s: %s\n' "$lib" "$(pkg-config --modversion "$lib")"; else printf 'MISSING pkg-config: %s\n' "$lib"; missing=1; fi
      done
    fi
    printf 'Portal services (inspect only; no backend is installed/enabled here):\n'
    if command -v systemctl >/dev/null; then systemctl --user --no-pager --plain list-units 'xdg-desktop-portal*' 2>/dev/null || true; fi
    exit "$missing"
    ;;
  build)
    [[ $# -le 2 ]] || fail 'Usage: arch-local.sh build [--update-lock]'
    lock=--locked
    if [[ "${2:-}" == --update-lock ]]; then
      lock=''
      printf 'Allowing Cargo.lock resolution. Review its diff after building.\n'
    elif [[ -n "${2:-}" ]]; then fail 'Unknown build option'; fi
    command -v cargo >/dev/null || fail 'Install a Rust toolchain first; see ARCH-HYPRLAND.md.'
    # Fixed target path keeps build/install consistent, regardless of caller cwd.
    cargo build --release --manifest-path "$ROOT/src-tauri/Cargo.toml" --target-dir "$ROOT/target" ${lock:+"$lock"}
    printf 'Binary: %s\n' "$BUILD"
    ;;
  install)
    [[ -x "$BUILD" ]] || fail 'Build the release binary first.'
    if [[ -e "$DESKTOP" || -e "$EXE" ]]; then managed || fail 'Existing installation is not managed by this script; refusing to overwrite it.'; fi
    mkdir -p -- "$BIN" "$(dirname -- "$DESKTOP")" "$(dirname -- "$ICON")"
    tmp=$(mktemp "$BIN/.markrust-install.XXXXXX")
    trap 'rm -f -- "$tmp"' EXIT
    install -m 755 -- "$BUILD" "$tmp"
    if [[ -f "$EXE" ]]; then cp -p -- "$EXE" "$EXE.previous"; fi
    mv -f -- "$tmp" "$EXE"
    install -m 644 -- "$ROOT/src-tauri/icons/128x128.png" "$ICON"
    # Desktop Exec field uses its own escaping, not shell quoting.
    quoted=${EXE//\\/\\\\}; quoted=${quoted//\"/\\\"}
    quoted=${quoted//\$/\\\$}; quoted=${quoted//\`/\\\`}; quoted=${quoted//%/%%}
    cat > "$DESKTOP" <<ENTRY
[Desktop Entry]
Type=Application
Name=MarkRust
Comment=Personal Markdown editor
Exec="$quoted"
Icon=$ICON
Terminal=false
Categories=Utility;TextEditor;
StartupNotify=true
X-MarkRust-Managed=true
ENTRY
    refresh
    printf 'Installed: %s\nLauncher: %s\n' "$EXE" "$DESKTOP"
    printf 'Run the binary directly first; then test your launcher. No Hyprland config was changed.\n'
    ;;
  rollback)
    managed || fail 'No managed local installation found.'
    [[ -x "$EXE.previous" ]] || fail 'No previous binary available.'
    tmp=$(mktemp "$BIN/.markrust-rollback.XXXXXX")
    trap 'rm -f -- "$tmp"' EXIT
    cp -p -- "$EXE.previous" "$tmp"
    cp -p -- "$EXE" "$EXE.previous"
    mv -f -- "$tmp" "$EXE"
    printf 'Restored previous binary. Recovery/user data was not changed.\n'
    ;;
  uninstall)
    managed || fail 'No managed local installation found; nothing removed.'
    rm -f -- "$EXE" "$EXE.previous" "$DESKTOP" "$ICON"
    refresh
    printf 'Local binary/launcher removed. Documents and app recovery data are untouched.\n'
    ;;
  *) printf 'Usage: %s {doctor|build [--update-lock]|install|rollback|uninstall}\n' "$0"; exit 1 ;;
esac
