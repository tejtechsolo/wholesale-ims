#!/usr/bin/env bash
# usage: ci-wait <sha>  -> polls check runs for that commit until all complete; prints results
set -uo pipefail
sha=$1
for i in $(seq 1 60); do
  out=$(timeout 30 gh api "repos/tejtechsolo/wholesale-ims/commits/$sha/check-runs" --jq '.check_runs[] | [.name, .status, (.conclusion // "-")] | @tsv' 2>/dev/null)
  if [ -n "$out" ] && ! echo "$out" | grep -qvP '\tcompleted\t'; then echo "$out"; exit 0; fi
  sleep 15
done
echo "timed out waiting; last: $out"; exit 1
