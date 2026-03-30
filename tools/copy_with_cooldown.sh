#!/bin/bash

# 这个脚本用于在慢速、易过热、易中断的外接存储介质之间稳健复制大文件。
# 设计目标：
# 1. 支持 rsync 断点续传能力，尽量减少中断后的重复拷贝
# 2. 支持带宽限制，降低 SD 卡或录音设备过热风险
# 3. 支持每个文件之间的冷却时间，给设备留出“降温窗口”
# 4. 支持失败重试、失败清单、日志记录，便于无人值守运行
# 5. 支持复制成功后的可选 hook，方便接入后处理脚本
#
# 典型用法示例：
# ./tools/copy_with_cooldown.sh \
#   --src "/Volumes/RV51 Pro/RECORD" \
#   --dst "/Users/caoting/Downloads/环境音" \
#   --bwlimit 1m \
#   --cooldown 30 \
#   --max-retry 3 \
#   --retry-wait 60 \
#   --log-file "/Users/caoting/Downloads/copy.log" \
#   --failed-list "/Users/caoting/Downloads/copy_failed.txt"

set -u

SCRIPT_NAME=$(basename "$0")

# 命令行参数默认值。
# 这些值都会被对应的 --xxx 参数覆盖。
SRC=""
DST=""
BWLIMIT="1m"
RSYNC_BWLIMIT=""
COOLDOWN=30
MAX_RETRY=3
RETRY_WAIT=60
LOG_FILE=""
FAILED_LIST=""
HOOK=""

usage() {
  # 帮助信息只描述 v1 的既定行为：
  # - 只处理源目录第一层普通文件
  # - 目标中已完整的同名文件直接跳过
  # - 目标中不完整的同名文件尝试借助 rsync 续传
  cat <<EOF
Usage:
  $SCRIPT_NAME --src <source_dir> --dst <target_dir> [options]

Options:
  --src <dir>           Source directory. Required.
  --dst <dir>           Target directory. Required.
  --bwlimit <value>     Rsync bandwidth limit. Default: $BWLIMIT
  --cooldown <seconds>  Cooldown after each file. Default: $COOLDOWN
  --max-retry <count>   Max retries per file. Default: $MAX_RETRY
  --retry-wait <sec>    Wait between retries. Default: $RETRY_WAIT
  --log-file <path>     Append logs to this file.
  --failed-list <path>  Write failed target paths for this run.
  --hook <command>      Run command after successful copy. Target file path is
                        passed as the final argument.
  --help                Show this help message.

Notes:
  - Copies only the first-level files under --src.
  - Existing complete files are skipped.
  - Existing partial files are resumed with rsync.
EOF
}

timestamp() {
  # 统一日志时间格式，便于终端查看和后续 grep。
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  # 所有运行期事件都走这里：
  # - 打印到终端
  # - 如指定 --log-file，则同时追加到日志文件
  local message="[$(timestamp)] $*"
  echo "$message"
  if [ -n "$LOG_FILE" ]; then
    printf '%s\n' "$message" >> "$LOG_FILE"
  fi
}

fail() {
  # 统一错误出口。
  # 这里会先记录日志，再以非零状态退出脚本。
  log "错误: $*"
  exit 1
}

append_failed() {
  # 将失败文件写入失败清单，便于任务结束后补拷。
  # 这里记录的是目标路径，方便直接定位到本次任务的目标位置。
  local target_path="$1"
  if [ -n "$FAILED_LIST" ]; then
    printf '%s\n' "$target_path" >> "$FAILED_LIST"
  fi
}

get_size() {
  # 读取文件大小。
  # macOS 的 stat 用法是 `stat -f %z`，Linux 常见是 `stat -c %s`。
  # 这里优先尝试 macOS 写法，失败再回退到 Linux 写法。
  local file_path="$1"

  if stat -f '%z' "$file_path" >/dev/null 2>&1; then
    stat -f '%z' "$file_path"
  else
    stat -c '%s' "$file_path"
  fi
}

run_hook() {
  # 可选后处理钩子：
  # 当 --hook 非空且文件复制成功后执行。
  # hook 的目标文件路径会作为最后一个参数附加到命令后面。
  #
  # 例如：
  # --hook 'python3 /path/to/waveform.py'
  #
  # 实际执行效果近似于：
  # python3 /path/to/waveform.py "/target/path/file.wav"
  local target_path="$1"

  if [ -z "$HOOK" ]; then
    return 0
  fi

  log "执行 hook: $HOOK $target_path"
  if bash -lc 'hook_cmd="$1"; target="$2"; eval "$hook_cmd \"\$target\""' _ "$HOOK" "$target_path"; then
    log "hook 完成: $target_path"
    return 0
  fi

  log "hook 失败: $target_path"
  return 1
}

validate_number() {
  # 校验“必须是非负整数”的参数。
  # 当前用于：
  # - cooldown
  # - max-retry
  # - retry-wait
  local name="$1"
  local value="$2"

  case "$value" in
    ''|*[!0-9]*)
      fail "$name 必须是非负整数: $value"
      ;;
  esac
}

normalize_bwlimit() {
  # 将用户输入的带宽参数转换成当前 rsync 可接受的值。
  #
  # 兼容性背景：
  # macOS 自带 rsync 通常比较老，不接受 `1m` 这种写法，
  # 更稳定的做法是传入 KB/s 的整数值。
  #
  # 支持输入示例：
  # - 512     -> 512 KB/s
  # - 512k    -> 512 KB/s
  # - 1m      -> 1024 KB/s
  # - 2g      -> 2097152 KB/s
  local value="$1"
  local number

  case "$value" in
    ''|*[!0-9kKmMgG]*)
      fail "bwlimit 格式无效: $value"
      ;;
  esac

  case "$value" in
    *[kK])
      number=${value%[kK]}
      validate_number "bwlimit" "$number"
      RSYNC_BWLIMIT="$number"
      ;;
    *[mM])
      number=${value%[mM]}
      validate_number "bwlimit" "$number"
      RSYNC_BWLIMIT=$((number * 1024))
      ;;
    *[gG])
      number=${value%[gG]}
      validate_number "bwlimit" "$number"
      RSYNC_BWLIMIT=$((number * 1024 * 1024))
      ;;
    *)
      validate_number "bwlimit" "$value"
      RSYNC_BWLIMIT="$value"
      ;;
  esac

  [ "$RSYNC_BWLIMIT" -gt 0 ] || fail "bwlimit 必须大于 0: $value"
}

parse_args() {
  # 解析标准参数式 CLI。
  # 这里有意不支持位置参数，避免后续扩展时语义混乱。
  while [ $# -gt 0 ]; do
    case "$1" in
      --src)
        [ $# -ge 2 ] || fail "--src 需要参数"
        SRC="$2"
        shift 2
        ;;
      --dst)
        [ $# -ge 2 ] || fail "--dst 需要参数"
        DST="$2"
        shift 2
        ;;
      --bwlimit)
        [ $# -ge 2 ] || fail "--bwlimit 需要参数"
        BWLIMIT="$2"
        shift 2
        ;;
      --cooldown)
        [ $# -ge 2 ] || fail "--cooldown 需要参数"
        COOLDOWN="$2"
        shift 2
        ;;
      --max-retry)
        [ $# -ge 2 ] || fail "--max-retry 需要参数"
        MAX_RETRY="$2"
        shift 2
        ;;
      --retry-wait)
        [ $# -ge 2 ] || fail "--retry-wait 需要参数"
        RETRY_WAIT="$2"
        shift 2
        ;;
      --log-file)
        [ $# -ge 2 ] || fail "--log-file 需要参数"
        LOG_FILE="$2"
        shift 2
        ;;
      --failed-list)
        [ $# -ge 2 ] || fail "--failed-list 需要参数"
        FAILED_LIST="$2"
        shift 2
        ;;
      --hook)
        [ $# -ge 2 ] || fail "--hook 需要参数"
        HOOK="$2"
        shift 2
        ;;
      --help)
        usage
        exit 0
        ;;
      *)
        fail "未知参数: $1"
        ;;
    esac
  done
}

parse_args "$@"

# 基础参数校验。
[ -n "$SRC" ] || fail "必须提供 --src"
[ -n "$DST" ] || fail "必须提供 --dst"
validate_number "cooldown" "$COOLDOWN"
validate_number "max-retry" "$MAX_RETRY"
validate_number "retry-wait" "$RETRY_WAIT"
normalize_bwlimit "$BWLIMIT"

# 运行前检查 rsync 是否可用，因为整个复制流程依赖它。
command -v rsync >/dev/null 2>&1 || fail "未找到 rsync"

# 源目录必须已存在；目标目录不存在时自动创建。
[ -d "$SRC" ] || fail "源目录不存在: $SRC"
mkdir -p "$DST" || fail "无法创建目标目录: $DST"

if [ -n "$LOG_FILE" ]; then
  # 日志文件按“追加”方式写入，保留历史执行记录。
  mkdir -p "$(dirname "$LOG_FILE")" || fail "无法创建日志目录: $(dirname "$LOG_FILE")"
  : >> "$LOG_FILE" || fail "无法写入日志文件: $LOG_FILE"
fi

if [ -n "$FAILED_LIST" ]; then
  # 失败清单按“本次运行重置”处理，避免混入旧结果。
  mkdir -p "$(dirname "$FAILED_LIST")" || fail "无法创建失败清单目录: $(dirname "$FAILED_LIST")"
  : > "$FAILED_LIST" || fail "无法写入失败清单: $FAILED_LIST"
fi

# 运行统计信息，用于最后输出汇总。
copied_count=0
skipped_count=0
failed_count=0

# 用于判断源目录中是否真的发现了可复制的普通文件。
found_files=0

# 只遍历源目录第一层文件，不递归子目录。
# 这样可以保持 v1 行为简单、可预期，也更贴近录音卡导出场景。
for source_path in "$SRC"/*; do
  [ -f "$source_path" ] || continue
  found_files=1

  file_name=$(basename "$source_path")
  target_path="$DST/$file_name"
  source_size=$(get_size "$source_path")

  if [ -f "$target_path" ]; then
    # 若目标中已存在同名文件，则先做轻量级“大小校验”：
    # - 大小一致：视为已完成，直接跳过
    # - 大小不一致：视为未完成，进入 rsync 复制流程
    target_size=$(get_size "$target_path")
    if [ "$target_size" -eq "$source_size" ]; then
      log "跳过已完成文件: $file_name"
      skipped_count=$((skipped_count + 1))
      log "冷却 ${COOLDOWN} 秒..."
      sleep "$COOLDOWN"
      continue
    fi

    log "检测到未完成文件，准备续传: $file_name (源 $source_size 字节, 目标 $target_size 字节)"
  else
    log "开始复制: $file_name"
  fi

  retry=0
  success=0

  # 单文件重试循环。
  # 只要没达到上限，就尝试再次复制。
  while [ "$retry" -lt "$MAX_RETRY" ]; do
    attempt=$((retry + 1))
    log "传输: $file_name (尝试 $attempt/$MAX_RETRY)"

    # 这里用 rsync 的理由：
    # - --partial: 中断时保留部分文件，便于下次继续
    # - --bwlimit: 限速，减少设备发热和掉盘概率
    # - -a -v --progress: 保留基本属性、显示进度和明细
    #
    # 注意：
    # 本机 macOS 自带 rsync 版本较老，所以没有使用 --append-verify。
    if rsync -av --progress --partial --bwlimit="$RSYNC_BWLIMIT" "$source_path" "$target_path"; then
      if [ ! -f "$target_path" ]; then
        log "复制后未找到目标文件: $target_path"
      else
        # 复制完成后默认只做“大小一致”校验。
        # 这是性能和可靠性之间的折中：比哈希更快，但比“只看 rsync 返回值”更稳。
        final_size=$(get_size "$target_path")
        if [ "$final_size" -eq "$source_size" ]; then
          log "复制完成: $file_name"
          copied_count=$((copied_count + 1))
          success=1

          # hook 失败不会把复制本身判定为失败，
          # 但会记录到失败清单，便于后续人工检查。
          if ! run_hook "$target_path"; then
            append_failed "$target_path"
          fi
          break
        fi

        log "大小校验失败: $file_name (源 $source_size 字节, 目标 $final_size 字节)"
      fi
    else
      log "复制失败: $file_name"
    fi

    retry=$((retry + 1))
    if [ "$retry" -lt "$MAX_RETRY" ]; then
      log "等待 ${RETRY_WAIT} 秒后重试: $file_name"
      sleep "$RETRY_WAIT"
    fi
  done

  if [ "$success" -ne 1 ]; then
    # 达到失败上限后，不中止整个任务，而是记录后继续。
    # 这是为了更适合长时间无人值守场景。
    failed_count=$((failed_count + 1))
    append_failed "$target_path"
    log "达到失败上限，跳过文件: $file_name"
  fi

  # 每个文件处理后都冷却一段时间，降低外接设备持续发热风险。
  log "冷却 ${COOLDOWN} 秒..."
  sleep "$COOLDOWN"
done

if [ "$found_files" -eq 0 ]; then
  # 源目录可能存在，但没有任何普通文件可复制。
  log "源目录没有可复制的文件: $SRC"
fi

# 输出任务汇总，便于快速判断本次任务结果。
log "任务完成: 成功 $copied_count, 跳过 $skipped_count, 失败 $failed_count"
