#!/usr/bin/env bash
# videos/ 안의 영상을 발표용으로 압축합니다.
#
#   ./tools/compress.sh            # 최대 1080p, 화질 우선
#   ./tools/compress.sh 720        # 최대 720p (더 작게)
#   ./tools/compress.sh 1080 20    # 높이 1080, CRF 20 (숫자가 낮을수록 고화질·큰 용량)
#
# 원본은 지우지 않고 videos/original/ 로 옮겨 보관합니다.
# 압축본이 원본 파일명을 그대로 가져가므로 videos.json 은 수정할 필요가 없습니다.
set -euo pipefail

HEIGHT="${1:-1080}"
CRF="${2:-23}"
cd "$(dirname "$0")/.."
SRC="videos"
KEEP="videos/original"

command -v ffmpeg >/dev/null || { echo "✗ ffmpeg 가 필요합니다. (brew install ffmpeg)"; exit 1; }
[ -d "$SRC" ] || { echo "✗ videos/ 폴더가 없습니다."; exit 1; }

shopt -s nullglob nocaseglob
files=("$SRC"/*.mp4 "$SRC"/*.mov "$SRC"/*.m4v "$SRC"/*.webm)
[ ${#files[@]} -gt 0 ] || { echo "✗ videos/ 에 영상 파일이 없습니다."; exit 1; }

mkdir -p "$KEEP"
printf '최대 높이 %sp · CRF %s · 영상 %d개\n\n' "$HEIGHT" "$CRF" "${#files[@]}"

total_before=0; total_after=0
for f in "${files[@]}"; do
  name="$(basename "$f")"
  stem="${name%.*}"
  out="$SRC/$stem.mp4"
  tmp="$SRC/.$stem.tmp.mp4"

  before=$(wc -c < "$f")
  printf '· %s\n' "$name"

  # 세로 영상도 안전하게: 높이가 기준보다 클 때만 줄이고, 치수는 짝수로 맞춥니다
  ffmpeg -y -loglevel error -i "$f" \
    -vf "scale='trunc(iw*min(1,${HEIGHT}/ih)/2)*2':'trunc(ih*min(1,${HEIGHT}/ih)/2)*2'" \
    -c:v libx264 -crf "$CRF" -preset slow -pix_fmt yuv420p \
    -c:a aac -b:a 160k -ac 2 \
    -movflags +faststart "$tmp"

  # 오디오 트랙 확인 — 소리가 빠지면 발표에서 치명적입니다
  if ! ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$tmp" | grep -q audio; then
    if ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$f" | grep -q audio; then
      echo "  ✗ 오디오가 사라졌습니다. 원본을 그대로 둡니다."
      rm -f "$tmp"; continue
    fi
    echo "  ⚠ 원본에 오디오 트랙이 없습니다."
  fi

  mv "$f" "$KEEP/$name"
  mv "$tmp" "$out"
  after=$(wc -c < "$out")
  total_before=$((total_before + before)); total_after=$((total_after + after))
  printf '  %6.1f MB → %6.1f MB  (%d%%)\n' \
    "$(echo "$before" | awk '{print $1/1048576}')" \
    "$(echo "$after"  | awk '{print $1/1048576}')" \
    "$((after * 100 / before))"
done

printf '\n합계  %.1f MB → %.1f MB\n' \
  "$(echo "$total_before" | awk '{print $1/1048576}')" \
  "$(echo "$total_after"  | awk '{print $1/1048576}')"
echo "원본은 $KEEP/ 에 보관했습니다. 확인 후 지우셔도 됩니다."
