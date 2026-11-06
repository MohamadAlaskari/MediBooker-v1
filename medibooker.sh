#!/bin/sh
# The control menu of the Docker stacks. Arguments go through: ./medibooker.sh dev up.
# It needs Node.js and Docker.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt. Bitte Node.js 26 installieren: https://nodejs.org" >&2
  exit 1
fi
exec node scripts/medibooker.ts "$@"
