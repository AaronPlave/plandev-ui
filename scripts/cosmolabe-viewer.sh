#!/usr/bin/env sh
# Builds the pinned @cosmolabe/viewer embed package (the 3D Mission View panel's dependency) from a public
# Cosmolabe commit and packs it to vendor/cosmolabe-viewer-0.1.0.tgz, the path package.json depends on.
# Run once before `npm install` on a fresh checkout (vendor/ is not committed), and again whenever
# COSMOLABE_COMMIT changes. package-lock.json records the tarball's integrity; this script checks the packed
# tarball against it, so a build that is not the reviewed one fails here rather than in `npm install`.
#
#   scripts/cosmolabe-viewer.sh            # clone + build into .cosmolabe/<commit>, pack into vendor/
#   COSMOLABE_SRC=~/code/cosmolabe scripts/cosmolabe-viewer.sh   # clone from a local checkout (no network
#                                          # for objects it has); that checkout is never modified
#   COSMOLABE_UPDATE_LOCK=1 ...            # after moving COSMOLABE_COMMIT: skip the check; run `npm install`
#                                          # afterwards to record the new integrity
set -eu
COSMOLABE_REPO=${COSMOLABE_REPO:-https://github.com/AaronPlave/cosmolabe.git}
COSMOLABE_COMMIT=b4e96f093c03a7623159c87bf9784c05f9c45cf9
here=$(cd "$(dirname "$0")/.." && pwd)
# Always a dedicated clone at the pinned commit: a developer's own checkout is only a clone source.
src=$here/.cosmolabe/$COSMOLABE_COMMIT
tarball=$here/vendor/cosmolabe-viewer-0.1.0.tgz

if [ ! -d "$src/.git" ]; then
  git clone --quiet --no-checkout "${COSMOLABE_SRC:-$COSMOLABE_REPO}" "$src"
  # A local source may not have the commit (an older checkout): fetch it from the public repo.
  git -C "$src" cat-file -e "$COSMOLABE_COMMIT^{commit}" 2>/dev/null || git -C "$src" fetch --quiet "$COSMOLABE_REPO" "$COSMOLABE_COMMIT"
fi
git -C "$src" checkout --quiet --detach "$COSMOLABE_COMMIT"
if [ -n "$(git -C "$src" status --porcelain --untracked-files=no)" ]; then
  echo "cosmolabe-viewer: $src has local changes; refusing to pack an unreviewed build" >&2
  exit 1
fi
(cd "$src" && npm ci --no-audit --no-fund && npm run build:embed)
# Packed beside the clone and checked before it replaces vendor/: a mismatched build never lands there.
packed=$src/.pack
rm -rf "$packed" && mkdir -p "$packed" "$here/vendor"
(cd "$src/apps/viewer" && npm pack --silent --pack-destination "$packed")

actual="sha512-$(openssl dgst -sha512 -binary "$packed/cosmolabe-viewer-0.1.0.tgz" | openssl base64 -A)"
expected=$(node -e "console.log(require('$here/package-lock.json').packages['node_modules/@cosmolabe/viewer'].integrity)")
if [ "$actual" != "$expected" ] && [ -z "${COSMOLABE_UPDATE_LOCK:-}" ]; then
  echo "cosmolabe-viewer: packed $actual, but package-lock.json pins $expected" >&2
  echo "  (moved COSMOLABE_COMMIT on purpose? rerun with COSMOLABE_UPDATE_LOCK=1, then npm install)" >&2
  exit 1
fi
mv "$packed/cosmolabe-viewer-0.1.0.tgz" "$tarball"
echo "packed $tarball from Cosmolabe $COSMOLABE_COMMIT ($actual)"
