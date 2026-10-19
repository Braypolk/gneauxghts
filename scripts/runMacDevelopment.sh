#!/bin/sh
# Sign before launch, then replace this wrapper so Tauri owns the app process.
set -eu
node_executable=$1
shift
binary=$1
shift
"$node_executable" "$(dirname "$0")/signMacExecutable.mjs" "$binary" com.braypolkinghorne.gneauxghts
exec "$binary" "$@"
