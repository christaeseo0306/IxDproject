#!/usr/bin/env bash
# 더블클릭하면 영상까지 GitHub 에 올립니다.
cd "$(dirname "$0")"
./tools/publish.sh
echo
echo "창을 닫으셔도 됩니다."
read -r -p "Enter 를 누르면 종료합니다."
