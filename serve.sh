#!/usr/bin/env bash
# 로컬 서버 실행 — http://localhost 은 보안 컨텍스트라 카메라가 정상 동작합니다.
set -uo pipefail
cd "$(dirname "$0")"

WANT="${1:-8000}"

# videos/ 구성이 바뀌었으면 재생 목록을 자동으로 맞춥니다 (파일명만 바꿔도 반영됨)
if command -v node >/dev/null 2>&1 && compgen -G "videos/*" >/dev/null 2>&1; then
  node tools/build-manifest.mjs --if-changed 2>/dev/null || true
fi

# 이미 쓰이는 포트면 비어 있는 다음 포트를 찾습니다.
# (다른 프로젝트가 8000 을 쓰고 있으면 엉뚱한 페이지가 열립니다)
PORT="$(python3 - "$WANT" <<'PY'
import socket, sys
want = int(sys.argv[1])
for p in range(want, want + 40):
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", p))
        except OSError:
            continue
        print(p); break
else:
    print(want)
PY
)"
[ "$PORT" = "$WANT" ] || echo "⚠ ${WANT} 번 포트를 다른 프로그램이 쓰고 있어 ${PORT} 번으로 띄웁니다."

URL="http://localhost:${PORT}/"

# 서버를 먼저 띄우고, 실제로 응답할 때까지 기다린 뒤 브라우저를 엽니다
if [ -f tools/serve.py ]; then
  python3 tools/serve.py "$PORT" &
else
  python3 -m http.server "$PORT" --bind 127.0.0.1 &
fi
SRV=$!
trap 'kill "$SRV" 2>/dev/null; exit 0' INT TERM

for _ in $(seq 1 50); do
  python3 - "$PORT" <<'PY' && break
import socket, sys
s = socket.socket()
s.settimeout(0.2)
try:
    s.connect(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(1)
finally:
    s.close()
PY
  sleep 0.1
done

if ! kill -0 "$SRV" 2>/dev/null; then
  echo "✗ 서버를 띄우지 못했습니다."
  exit 1
fi

echo
echo "▸ ${URL}"
echo "▸ Figma Slide 링크에 위 주소를 넣으세요. 종료는 Ctrl+C."
echo
command -v open     >/dev/null && open     "$URL" 2>/dev/null || true
command -v xdg-open >/dev/null && xdg-open "$URL" 2>/dev/null || true

wait "$SRV"
