#!/usr/bin/env sh
# Builds the pinned @cosmolabe/viewer embed package (the 3D Mission View panel's dependency) from a public
# Cosmolabe commit and packs it to vendor/cosmolabe-viewer-0.1.0.tgz, the path package.json depends on.
# Run once before `npm install` (and again whenever COSMOLABE_COMMIT changes). package-lock.json records the
# tarball's integrity, so `npm install` refuses a tarball that is not the reviewed build.
#
#   scripts/cosmolabe-viewer.sh            # clone + build into .cosmolabe/<commit>, pack into vendor/
#   COSMOLABE_SRC=~/code/cosmolabe scripts/cosmolabe-viewer.sh   # build from an existing checkout instead
set -eu
COSMOLABE_REPO=${COSMOLABE_REPO:-https://github.com/AaronPlave/cosmolabe.git}
COSMOLABE_COMMIT=8da48a357da880070f5fc1280753d30febeb636c
here=$(cd "$(dirname "$0")/.." && pwd)
src=${COSMOLABE_SRC:-$here/.cosmolabe/$COSMOLABE_COMMIT}

if [ -z "${COSMOLABE_SRC:-}" ] && [ ! -d "$src/.git" ]; then
  git clone --quiet --filter=blob:none "$COSMOLABE_REPO" "$src"
fi
git -C "$src" checkout --quiet --detach "$COSMOLABE_COMMIT"
if [ -n "$(git -C "$src" status --porcelain --untracked-files=no)" ]; then
  echo "cosmolabe-viewer: $src has local changes; refusing to pack an unreviewed build" >&2
  exit 1
fi
(cd "$src" && npm ci --no-audit --no-fund && npm run build:embed)
mkdir -p "$here/vendor"
(cd "$src/apps/viewer" && npm pack --silent --pack-destination "$here/vendor")
echo "packed $here/vendor/cosmolabe-viewer-0.1.0.tgz from Cosmolabe $COSMOLABE_COMMIT"
