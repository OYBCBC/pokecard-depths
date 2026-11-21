#!/bin/bash
# 抓取 M11 物种素材（SpriteCollab 动画 + PokeAPI 叫声）：F4 新敌 3 只 + M11-C 新搭档 2 只 + 终 Boss。
# 可重复运行：已存在且非空则跳过。网络抖动自动重试（本机到 raw.githubusercontent 偶发超时）。
set -u
cd "$(dirname "$0")/.."
COMMIT=6226934f1bd2de67df85724348d423c901177e8d
SBASE="https://raw.githubusercontent.com/PMDCollab/SpriteCollab/$COMMIT/sprite"
PBASE="https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest"

SPECIES="93 200 355 359 131 491"
ANIMS="Walk Idle Hurt Attack Charge"

fetch() { # url dest tryN
  [ -s "$2" ] && return 0
  local n=0
  while [ $n -lt "${3:-4}" ]; do
    curl -sfL --connect-timeout 10 --max-time 60 -o "$2" "$1" && return 0
    rm -f "$2"; n=$((n+1)); sleep 2
  done
  return 1
}

ok=0; miss=""
for dex in $SPECIES; do
  d4=$(printf '%04d' "$dex")
  dir=".cache/sprite/$d4"
  mkdir -p "$dir" "assets/cries"
  fetch "$SBASE/$d4/AnimData.xml" "$dir/AnimData.xml" 5 || { miss="$miss $d4:xml"; continue; }
  fetch "$SBASE/$d4/credits.txt" "$dir/credits.txt" 2 || true
  animOk=0
  for anim in $ANIMS; do
    fetch "$SBASE/$d4/$anim-Anim.png" "$dir/$anim-Anim.png" 4 && animOk=$((animOk+1)) || { rm -f "$dir/$anim-Anim.png"; continue; }
    fetch "$SBASE/$d4/$anim-Offsets.png" "$dir/$anim-Offsets.png" 2 || rm -f "$dir/$anim-Offsets.png"
  done
  fetch "$PBASE/$dex.ogg" "assets/cries/$dex.ogg" 3 || rm -f "assets/cries/$dex.ogg"
  if [ $animOk -ge 3 ]; then ok=$((ok+1)); else miss="$miss $d4:anims$animOk"; fi
done
echo "M11 物种完成 $ok / $(echo $SPECIES | wc -w | tr -d ' ')；缺:$miss"
