#!/usr/bin/env bash
# usage: pr <head-branch> <title> <body-file>   -> prints PR number
set -euo pipefail
timeout 60 gh api repos/tejtechsolo/wholesale-ims/pulls -f head="$1" -f base=main -f title="$2" -F body=@"$3" --jq .number
