#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p mkdir -p dist
/usr/bin/time -p cp -f index.html dist/index.html
/usr/bin/time -p test -f index.html
/usr/bin/time -p test -f dist/index.html
/usr/bin/time -p node "${RUNTIME_DIR:?}/scripts/default-start.mjs"
