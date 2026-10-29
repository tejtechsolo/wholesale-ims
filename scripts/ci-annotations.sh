#!/usr/bin/env bash
# usage: ci-annotations <sha>  -> failure annotations (test errors) for that commit
sha=$1
for cr in $(timeout 30 gh api "repos/tejtechsolo/wholesale-ims/commits/$sha/check-runs" --jq '.check_runs[] | select(.conclusion=="failure") | .id'); do
  timeout 30 gh api "repos/tejtechsolo/wholesale-ims/check-runs/$cr/annotations" --jq '.[] | select(.path != ".github") | .path + ":" + (.start_line|tostring) + " | " + (.message|.[0:600])'
done
