#!/usr/bin/env bash
# 최신 코드로 업데이트하고 바로 실행합니다.
# videos/ 폴더의 영상은 건드리지 않습니다.
#
#   bash update.sh          # 업데이트 후 실행
#   bash update.sh 8777     # 포트 지정
set -uo pipefail
cd "$(dirname "$0")"

BRANCH="claude/dazzling-albattani-vi1z0v"
URL="https://github.com/christaeseo0306/IxDproject/archive/refs/heads/${BRANCH}.tar.gz"

echo "▸ 최신 코드를 받는 중…"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if curl -fsSL --max-time 20 "$URL" | tar xz -C "$tmp" --strip-components=1 2>/dev/null; then
  UPDATED=1
else
  UPDATED=0
  echo "· 받지 못했습니다 — 지금 폴더에 있는 것으로 실행합니다."
fi

if [ "$UPDATED" = "1" ]; then

  # 앱 파일만 덮어씁니다 — 영상과 videos/ 폴더는 그대로입니다
  for f in index.html app.js styles.css serve.sh start.command publish.command update.sh \
           videos.sample.json README.md PRESENTER.md; do
    [ -f "$tmp/$f" ] && cp "$tmp/$f" "./$f"
  done
  mkdir -p tools assets
  cp "$tmp"/tools/* tools/ 2>/dev/null || true
  chmod +x serve.sh start.command publish.command update.sh 2>/dev/null || true
  rm -f videos.json                            # 재생 목록을 새 규칙으로 다시 만듭니다
  echo "▸ 업데이트 완료"
fi

xattr -dr com.apple.quarantine . 2>/dev/null || true   # 더블클릭이 계속 되도록
echo
exec bash serve.sh "${1:-8000}"
