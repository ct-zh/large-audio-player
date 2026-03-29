#!/bin/bash

SRC="/Volumes/RV51 Pro/RECORD/"
DST="/Users/caoting/Downloads/环境音/"
BWLIMIT="1m"
COOLDOWN=30
MAX_RETRY=3

mkdir -p "$DST"

for f in "$SRC"*.WAV; do
  [ -e "$f" ] || continue
  fname=$(basename "$f")
  retry=0

  while [ $retry -lt $MAX_RETRY ]; do
    echo "[$(date '+%H:%M:%S')] 复制: $fname (尝试 $((retry+1))/$MAX_RETRY)"

    if rsync -av --progress --partial --bwlimit=$BWLIMIT "$f" "$DST"; then
      echo "[$(date '+%H:%M:%S')] 完成: $fname"
      echo "[$(date '+%H:%M:%S')] 生成波形图: $fname"
      python3 "/Users/caoting/Downloads/环境音/waveform.py" "$DST$fname"
      break
    else
      retry=$((retry+1))
      echo "[$(date '+%H:%M:%S')] 失败，等待 60 秒后重试..."
      sleep 60
    fi
  done

  echo "冷却 ${COOLDOWN} 秒..."
  sleep $COOLDOWN
done

echo "全部完成"
