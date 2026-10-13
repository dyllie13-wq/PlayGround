#!/usr/bin/env bash
# Capture desktop + mobile screenshots of the exact CAPTURE_URL.
# - Output goes to CAPTURE_DIR (outside the source tree); the app is left running.
# - Exit 75: temporary navigation/browser infrastructure failure.
# - Exit 1: script misuse or rendering defect.
set -euo pipefail

time -p cd "$(dirname "$0")"
if /usr/bin/time -p test -z "${CAPTURE_URL:-}"; then
  echo "Set CAPTURE_URL and CAPTURE_DIR." >&2
  exit 1
fi
if /usr/bin/time -p test -z "${CAPTURE_DIR:-}"; then
  echo "Set CAPTURE_URL and CAPTURE_DIR." >&2
  exit 1
fi
time -p echo "capturing: $CAPTURE_URL -> $CAPTURE_DIR"
/usr/bin/time -p mkdir -p "$CAPTURE_DIR"

/usr/bin/time -p node scripts/capture.mjs

/usr/bin/time -p test -f "$CAPTURE_DIR/final-desktop.png"
/usr/bin/time -p test -f "$CAPTURE_DIR/final-mobile.png"
/usr/bin/time -p ls -la "$CAPTURE_DIR"
