#!/usr/bin/env bash
# 더블클릭하면 터미널이 열리며 서버가 뜹니다.
# 터미널에서는: bash start.command  (파일을 터미널 창으로 끌어다 놓아도 됩니다)
cd "$(dirname "$0")"
exec bash serve.sh "${1:-8000}"
