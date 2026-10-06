#!/usr/bin/env bash
# 로컬 서버 실행 — http://localhost 은 보안 컨텍스트라 카메라가 정상 동작합니다.
set -euo pipefail
PORT="${1:-8000}"
cd "$(dirname "$0")"

# videos/ 구성이 바뀌었으면 재생 목록을 자동으로 맞춥니다 (파일명만 바꿔도 반영됨)
if command -v node >/dev/null 2>&1 && compgen -G "videos/*" >/dev/null 2>&1; then
  node tools/build-manifest.mjs --if-changed 2>/dev/null || true
fi

URL="http://localhost:${PORT}/"
echo
echo "▸ ${URL}"
echo "▸ Figma Slide 링크에 위 주소를 넣으세요. 종료는 Ctrl+C."
echo
command -v open  >/dev/null && open  "$URL" 2>/dev/null || true
command -v xdg-open >/dev/null && xdg-open "$URL" 2>/dev/null || true
# 구간 요청을 지원하는 서버 — 큰 영상도 즉시 재생되고 되감기가 빠릅니다
if [ -f tools/serve.py ]; then
  exec python3 tools/serve.py "$PORT"
else
  exec python3 -m http.server "$PORT"
fi
