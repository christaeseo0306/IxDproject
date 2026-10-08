#!/usr/bin/env bash
# 더블클릭하면 최신 코드로 맞춘 뒤 서버를 띄웁니다.
# 인터넷이 안 되면 지금 폴더에 있는 것으로 그냥 실행합니다.
cd "$(dirname "$0")" || exit 1
xattr -dr com.apple.quarantine . 2>/dev/null || true   # 다음부터는 경고 없이 열립니다
if [ -f update.sh ]; then
  exec bash update.sh "$@"
fi
exec bash serve.sh "$@"
