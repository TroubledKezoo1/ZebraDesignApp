#!/bin/sh
# Runs a command; when it fails, repeats the tail of its output as a GitHub annotation
# (job logs are not always readable from outside, annotations are).
LOG=$(mktemp)
"$@" > "$LOG" 2>&1
rc=$?
cat "$LOG"
if [ $rc -ne 0 ]; then
  MSG=$(tail -n 40 "$LOG" | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}' | cut -c1-3500)
  echo "::error title=step failed::$MSG"
fi
exit $rc
