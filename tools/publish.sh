#!/usr/bin/env bash
# 영상까지 GitHub 에 올려서, 웹사이트에 들어가기만 하면 바로 재생되게 합니다.
# 한 번 올려두면 그 뒤로는 아무것도 넣을 필요가 없습니다.
#
#   ./tools/publish.sh                # 압축 후 올리기 (권장)
#   ./tools/publish.sh --no-compress  # 원본 그대로 올리기
set -euo pipefail
cd "$(dirname "$0")/.."

COMPRESS=1
[ "${1:-}" = "--no-compress" ] && COMPRESS=0

# 압축만 풀어 쓰는 폴더라면 저장소에 연결합니다 (영상은 그대로 두고 코드만 맞춥니다)
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  URL="${REPO_URL:-}"
  [ -z "$URL" ] && [ -f .repo-url ] && URL="$(tr -d '[:space:]' < .repo-url)"
  if [ -z "$URL" ]; then
    echo "이 폴더를 어느 GitHub 저장소에 올릴까요?"
    echo "예) https://github.com/사용자이름/저장소이름"
    printf "주소를 붙여넣고 Enter: "
    read -r URL
  fi
  [ -n "$URL" ] || { echo "✗ 저장소 주소가 필요합니다."; exit 1; }
  printf '%s\n' "$URL" > .repo-url

  echo "▸ 저장소에 연결하는 중 — $URL"
  git init -q
  git remote add origin "$URL"
  BR="${BRANCH:-claude/dazzling-albattani-vi1z0v}"
  if ! git fetch -q --depth=1 origin "$BR" 2>/dev/null; then
    echo "✗ 저장소에서 '$BR' 브랜치를 가져오지 못했습니다. 주소와 접근 권한을 확인해주세요."
    rm -f .repo-url; exit 1
  fi
  git reset --mixed -q FETCH_HEAD
  git checkout -q -- .            # 앱 파일은 저장소 최신으로 (영상은 추적 대상이 아니라 그대로)
  git branch -M "$BR" 2>/dev/null || true
  echo "▸ 연결 완료"
  echo
fi
shopt -s nullglob nocaseglob
vids=(videos/*.mp4 videos/*.webm videos/*.mov videos/*.m4v)
[ ${#vids[@]} -gt 0 ] || { echo "✗ videos/ 에 영상이 없습니다. 먼저 영상을 넣어주세요."; exit 1; }

# 1) 압축 — GitHub 은 파일당 100MB 제한이 있습니다
if [ "$COMPRESS" = "1" ]; then
  if command -v ffmpeg >/dev/null 2>&1; then
    echo "▸ 영상 압축"
    ./tools/compress.sh 1080
    echo
  else
    echo "⚠ ffmpeg 가 없어 압축을 건너뜁니다."
    echo "  용량이 크면 Finder 에서 줄일 수 있습니다 —"
    echo "  videos 폴더의 영상을 모두 선택 → 우클릭 → 빠른 동작 → 미디어 인코딩 → 720p" 
  fi
fi

# 2) 재생 목록 갱신 — 같은 번호가 겹치면 여기서 멈춥니다
if command -v node >/dev/null 2>&1; then
  if ! node tools/build-manifest.mjs --if-changed; then
    echo
    echo "위 문제를 정리한 뒤 다시 실행해주세요."
    exit 1
  fi
  echo
fi

# 3) 용량 점검
vids=(videos/*.mp4 videos/*.webm videos/*.mov videos/*.m4v)
total=0; toobig=0
for f in "${vids[@]}"; do
  sz=$(wc -c < "$f"); total=$((total + sz))
  if [ "$sz" -gt 104857600 ]; then
    printf '✗ %s 가 100MB 를 넘습니다 (%.0f MB).\n' \
      "$(basename "$f")" "$(echo "$sz" | awk '{print $1/1048576}')"
    echo "  줄이는 방법 — 둘 중 하나"
    echo "   · ./tools/compress.sh 720"
    echo "   · Finder 에서 그 영상 우클릭 → 빠른 동작 → 미디어 인코딩 → 720p" 
    toobig=1
  fi
done
[ "$toobig" = "0" ] || exit 1
printf '▸ 올릴 영상 %d개 · %.1f MB\n' "${#vids[@]}" "$(echo "$total" | awk '{print $1/1048576}')"

# 파트가 나뉘어 있는지 확인 — 전부 영상통화면 CCTV 연출이 나오지 않습니다
if command -v node >/dev/null 2>&1 && [ -f videos.json ]; then
  cctv=$(node -e "try{const m=require('./videos.json');console.log(m.clips.filter(c=>c.part==='cctv').length)}catch(e){console.log(0)}")
  if [ "$cctv" = "0" ]; then
    echo "⚠ CCTV 파트가 하나도 없습니다. 몇 번부터 CCTV 인지 한 번만 알려주세요:"
    echo "    node tools/build-manifest.mjs --cctv-from=5   (그 뒤 다시 ./tools/publish.sh)"
  fi
fi
if [ "$total" -gt 524288000 ]; then
  echo "⚠ 500MB 가 넘습니다. GitHub Pages 는 사이트당 1GB 제한이 있습니다."
fi

# 4) 영상을 추적 대상으로 (videos/original/ 은 계속 제외)
if ! grep -q '^!videos/\*\.mp4' .gitignore 2>/dev/null; then
  cat >> .gitignore <<'IGN'

# 발표용 영상을 저장소에 포함 (tools/publish.sh)
!videos/*.mp4
!videos/*.webm
!videos/*.mov
!videos/*.m4v
!videos.json
IGN
fi

# 5) 커밋 & 푸시
branch="$(git rev-parse --abbrev-ref HEAD)"
git add -A .gitignore videos videos.json 2>/dev/null || git add -A
if git diff --cached --quiet; then
  echo "▸ 바뀐 것이 없습니다."
else
  git commit -q -m "발표용 영상을 저장소에 포함

웹사이트에 들어가기만 하면 바로 재생되도록 영상을 함께 올린다."
  echo "▸ 커밋 완료"
fi

echo "▸ 푸시"
for i in 1 2 3 4; do
  if git push -u origin "$branch"; then break; fi
  echo "  재시도 ${i}..."; sleep $((2 ** i))
done

remote="$(git remote get-url origin)"
if printf '%s' "$remote" | grep -q 'github\.com'; then
  user="$(printf '%s' "$remote" | sed -E 's#.*github\.com[:/]([^/]+)/([^/.]+).*#\1#')"
  repo="$(printf '%s' "$remote" | sed -E 's#.*github\.com[:/]([^/]+)/([^/.]+).*#\2#')"
else
  echo; echo "완료했습니다. 원격: $remote"; exit 0
fi

cat <<MSG

────────────────────────────────────────────────
완료했습니다.

GitHub Pages 가 아직 꺼져 있다면 한 번만 켜주세요
  https://github.com/${user}/${repo}/settings/pages
  Source: Deploy from a branch
  Branch: ${branch} / (root)  →  Save

1~2분 뒤 이 주소로 들어가면 영상이 바로 재생됩니다
  https://${user}.github.io/${repo}/

이 주소를 Figma Slide 링크에 넣으세요. 다시 넣을 일은 없습니다.
────────────────────────────────────────────────
MSG
