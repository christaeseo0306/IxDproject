#!/usr/bin/env bash
# macOS 에서 더블클릭하면 터미널이 열리며 서버가 뜹니다.
cd "$(dirname "$0")"
exec ./serve.sh 8000
