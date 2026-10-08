#!/usr/bin/env bash
# 로컬 서버 실행 — http://localhost 은 보안 컨텍스트라 카메라가 정상 동작합니다.
#   bash serve.sh          # 8000 번부터 비어 있는 포트를 찾아 띄웁니다
#   bash serve.sh 8777     # 포트 지정
cd "$(dirname "$0")" || exit 1

command -v python3 >/dev/null 2>&1 || {
  echo "✗ python3 이 필요합니다. 터미널에서 'xcode-select --install' 을 실행해 설치해주세요."
  exit 1
}

# videos/ 구성이 바뀌었으면 재생 목록을 맞춥니다 (파일명만 바꿔도 반영됨)
if command -v node >/dev/null 2>&1 && [ -d videos ]; then
  node tools/build-manifest.mjs --if-changed || {
    echo
    echo "위 문제를 정리한 뒤 다시 실행해주세요."
    exit 1
  }
fi

exec python3 tools/serve.py "${1:-}"
