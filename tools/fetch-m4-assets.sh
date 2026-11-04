#!/bin/bash
# 抓取 M4 物种素材（SpriteCollab 动画 + PokeAPI 叫声）。可重复运行：已存在且非空则跳过。
set -u
cd "$(dirname "$0")/.."
COMMIT=6226934f1bd2de67df85724348d423c901177e8d
SBASE="https://raw.githubusercontent.com/PMDCollab/SpriteCollab/$COMMIT/sprite"
PBASE="https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest"

SPECIES="26 100 81 88 109 60 52 101 82 63 92 27 66 111 352 28 94 65 133 104 61"
ANIMS="Walk Idle Hurt Attack Charge"

fetch() { # url dest
  [ -s "$2" ] && return 0
  curl -sfL --connect-timeout 8 --max-time 45 --retry 2 -o "$2" "$1" && return 0
  rm -f "$2"; return 1
}

ok=0; miss=""
for dex in $SPECIES; do
  d4=$(printf '%04d' "$dex")
  dir=".cache/sprite/$d4"
  mkdir -p "$dir" "assets/cries"
  # AnimData 与 credits
  fetch "$SBASE/$d4/AnimData.xml" "$dir/AnimData.xml" || { miss="$miss $d4:xml"; continue; }
  fetch "$SBASE/$d4/credits.txt" "$dir/credits.txt" || true
  # 每动画：Anim + Offsets（缺失不阻塞——打包器按存在的打包）
  for anim in $ANIMS; do
    fetch "$SBASE/$d4/$anim-Anim.png" "$dir/$anim-Anim.png" || { rm -f "$dir/$anim-Anim.png"; continue; }
    fetch "$SBASE/$d4/$anim-Offsets.png" "$dir/$anim-Offsets.png" || rm -f "$dir/$anim-Offsets.png"
  done
  # 叫声
  fetch "$PBASE/$dex.ogg" "assets/cries/$dex.ogg" || rm -f "assets/cries/$dex.ogg"
  ok=$((ok+1))
done
echo "物种完成 $ok / $(echo $SPECIES | wc -w | tr -d ' ')；缺:$miss"
