#!/usr/bin/env bash
# Build the Linux packages (.deb + AppImage) for Amen.
#
# Runs on Ubuntu 24.04+ / Debian 13+ — the versions that ship WebKitGTK 4.1,
# which Tauri v2 requires. Ubuntu 22.04 and older only have 4.0 and cannot
# build this; use a 24.04 container there.
#
# From Windows, run it inside WSL:
#   wsl -d Ubuntu -u root -- bash /mnt/c/Users/user/Desktop/amen/scripts/build-linux.sh
#
# Note the packages link against the glibc of the machine that builds them, so
# build on the OLDEST distribution you intend to support.
set -euo pipefail

SRC="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WORK="${WORK_DIR:-$HOME/amen-build}"

echo "==> Build dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  pkg-config libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
  desktop-file-utils ffmpeg

if ! command -v cargo >/dev/null 2>&1; then
  echo "==> Rust"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable
fi
# shellcheck disable=SC1091
. "$HOME/.cargo/env"

# Tailwind v4's native package (@tailwindcss/oxide-linux-x64-gnu) requires
# Node >= 20. npm SILENTLY SKIPS an optional dependency whose engines do not
# match, so on Node 18 the build dies with a bare "Cannot find native binding"
# that never mentions the version. Prefer a distro Node 20+ if an older one is
# earlier in PATH, and install one if there is none.
if [ -x /usr/bin/node ] && [ "$(/usr/bin/node -p 'process.versions.node.split(".")[0]')" -ge 20 ] 2>/dev/null; then
  export PATH=/usr/bin:$PATH
fi
if ! command -v node >/dev/null 2>&1 \
   || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Node.js 20 (current: $(command -v node >/dev/null && node --version || echo none))"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  export PATH=/usr/bin:$PATH
fi
echo "==> node $(node --version), npm $(npm --version)"

# Copy the tree out of /mnt/c: building across the 9p filesystem boundary is
# many times slower than building on the Linux filesystem.
echo "==> Staging source into $WORK"
rm -rf "$WORK"
mkdir -p "$WORK"
tar cf - -C "$SRC" \
    --exclude=node_modules --exclude=dist --exclude=.git \
    --exclude=src-tauri/target --exclude=test-results --exclude=playwright-report \
    . | (cd "$WORK" && tar xf -)

cd "$WORK"
# Resolve dependencies fresh rather than with `npm ci`. A lockfile committed
# from Windows pins Windows-only optional native packages
# (@rollup/rollup-win32-x64-msvc, @esbuild/win32-x64), so an exact install
# leaves vite without a native binding and the build fails. This is a staging
# copy, so the repository's lockfile is not modified.
echo "==> npm install"
# Both the lockfile and any existing tree must go: npm keeps optional native
# packages that are already on disk, so leaving node_modules in place means the
# Windows-only bindings survive and the Linux ones are never resolved.
rm -rf node_modules package-lock.json
npm install --no-audit --no-fund

echo "==> Rust tests"
(cd src-tauri && cargo test --no-default-features)

echo "==> tauri build"
npx tauri build --bundles deb,appimage

OUT="$SRC/dist-linux"
mkdir -p "$OUT"
find "$WORK/src-tauri/target/release/bundle" \
  \( -name '*.deb' -o -name '*.AppImage' \) -exec cp -v {} "$OUT/" \;

echo
echo "==> Packages copied to $OUT"
ls -lh "$OUT"
