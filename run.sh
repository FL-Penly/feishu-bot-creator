#!/bin/bash
# feishu-bot-creator 一键创建飞书机器人（长连接模式）
# 用法: ./run.sh [机器人名称] [机器人描述]
#
# 示例:
#   ./run.sh
#   ./run.sh "my-bot"
#   ./run.sh "my-bot" "测试机器人"

set -e

NAME="${1:-my-bot}"
DESC="${2:-$NAME}"

cd "$(dirname "$0")"

# 直接跑 TypeScript 源码，无需编译
npx tsx src/index.ts create-bot --name "$NAME" --desc "$DESC"
