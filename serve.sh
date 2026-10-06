#!/usr/bin/env bash
# 로컬 서버 실행 — http://localhost 은 보안 컨텍스트라 카메라가 정상 동작합니다.
set -euo pipefail
PORT="${1:-8000}"
cd "$(dirname "$0")"
URL="http://localhost:${PORT}/"
echo "▸ ${URL}"
echo "▸ Figma Slide 링크에 위 주소를 넣으세요. 종료는 Ctrl+C."
command -v open  >/dev/null && open  "$URL" 2>/dev/null || true
command -v xdg-open >/dev/null && xdg-open "$URL" 2>/dev/null || true
exec python3 -m http.server "$PORT"
