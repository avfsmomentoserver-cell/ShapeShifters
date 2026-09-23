#!/usr/bin/env bash
# Build the downloadable source archive that the app serves from Data & Export.
#
# The zip is written into public/ so `vite build` copies it into dist/ as part of
# the deployable bundle. `npm run build` runs this first, so you rarely need to
# call it directly.
#
# A build-time manifest (frontend/lib/source-archive.json) carries the size and
# file count into the bundle. The app cannot measure the archive at runtime
# because the hosting proxy blocks XHR against its own static files, even though
# a plain anchor download works. The manifest is part of the source, so writing
# it changes the archive that it describes — the loop below re-packs until the
# numbers are a fixed point, which makes the copy inside the zip identical to
# the zip being served.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

out="public/momento-source.zip"
manifest="frontend/lib/source-archive.json"
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p public

pack() {
  rm -f "$out"
  zip -rqX "$out" \
    README.md \
    package.json \
    package-lock.json \
    index.html \
    vite.config.ts \
    tailwind.config.ts \
    postcss.config.js \
    tsconfig.json \
    tsconfig.app.json \
    .gitignore \
    frontend \
    backend \
    scripts \
    public \
    -x '*/node_modules/*' \
    -x '*/__pycache__/*' \
    -x '*.pyc' \
    -x 'backend/momento.db*' \
    -x 'public/*.zip' \
    -x '*/.DS_Store'
}

write_manifest() {
  cat > "$manifest" <<JSON
{
  "bytes": $1,
  "files": $2,
  "builtAt": "$built_at"
}
JSON
}

bytes=0
files=0
for pass in 1 2 3 4; do
  pack
  new_bytes=$(stat -c%s "$out")
  new_files=$(unzip -l "$out" | tail -1 | awk '{print $2}')
  if [ "$new_bytes" = "$bytes" ] && [ "$new_files" = "$files" ]; then
    printf 'manifest converged after %d passes\n' "$((pass - 1))"
    break
  fi
  bytes=$new_bytes
  files=$new_files
  write_manifest "$bytes" "$files"
done

printf 'wrote %s (%s, %s files)\n' "$out" "$(du -h "$out" | cut -f1)" "$files"
