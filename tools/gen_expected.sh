#!/bin/bash
# Regenerates tests/fixtures/expected.jsonl from the C++ decoder of harbour-mahlebike.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${MAHLEBIKE_SRC:-$HOME/sfos-wp/harbour-mahlebike/src}"
g++ -std=c++17 -I"$SRC" -o /tmp/ref_decode_$$ "$HERE/ref_decode.cpp" "$SRC/protocol/mahle.cpp"
python3 -c "import json;print('\n'.join(json.load(open('$HERE/../tests/fixtures/frames.json'))['frames']))" \
  | /tmp/ref_decode_$$ > "$HERE/../tests/fixtures/expected.jsonl"
rm -f /tmp/ref_decode_$$
wc -l "$HERE/../tests/fixtures/expected.jsonl"
