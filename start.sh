#!/usr/bin/env bash
# Alt Life static project launcher.
# - Source + built output stay inside PROJECT_DIR (build -> ./dist).
# - OPENCODE_WEB_DIR / RUNNER_TEMP are used only for worker metadata
#   (deployment-output.json), never for build output.
# - Serves ./dist in the FOREGROUND on PORT (default 3000).
set -euo pipefail

time -p cd "$(dirname "$0")"
PROJECT_DIR="${PROJECT_DIR:-$PWD}"
time -p echo "project: $PROJECT_DIR"
PORT="${PORT:-3000}"
time -p echo "port: $PORT"
DIST="$PROJECT_DIR/dist"
OUT_DIR="${OPENCODE_WEB_DIR:?OPENCODE_WEB_DIR must be set}"

/usr/bin/time -p mkdir -p "$DIST" "$OUT_DIR"

# Install dependencies when a package manifest exists.
if /usr/bin/time -p test -f "$PROJECT_DIR/package.json"; then
  if /usr/bin/time -p test -f "$PROJECT_DIR/package-lock.json"; then
    /usr/bin/time -p npm --prefix "$PROJECT_DIR" ci --no-audit --no-fund
  else
    /usr/bin/time -p npm --prefix "$PROJECT_DIR" install --no-audit --no-fund
  fi
  if /usr/bin/time -p node -e "process.exit(require('$PROJECT_DIR/package.json').scripts?.build?0:1)"; then
    /usr/bin/time -p npm --prefix "$PROJECT_DIR" run build
  fi
else
  # Dependency-free static build: sync source into ./dist when needed.
  /usr/bin/time -p cp -f "$PROJECT_DIR/index.html" "$DIST/index.html"
  /usr/bin/time -p cp -f "$PROJECT_DIR/styles.css" "$DIST/styles.css"
  /usr/bin/time -p cp -f "$PROJECT_DIR/app.js" "$DIST/app.js"
  /usr/bin/time -p cp -f "$PROJECT_DIR/game.js" "$DIST/game.js"
fi

/usr/bin/time -p test -f "$DIST/index.html"
/usr/bin/time -p node -e "const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({project:process.argv[2],directory:process.argv[3]}))" \
  "$OUT_DIR/deployment-output.json" "$PROJECT_DIR" "$DIST"
/usr/bin/time -p cat "$OUT_DIR/deployment-output.json"

# Foreground server (controller reuses this tmux session while healthy).
exec node "$PROJECT_DIR/scripts/serve.mjs" "$DIST"
