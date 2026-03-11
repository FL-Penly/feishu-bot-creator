# feishu-bot-creator

飞书开放平台 CLI 工具 —— 一键创建飞书机器人（长连接模式）。

通过 Puppeteer 捕获浏览器登录凭证，调用飞书开放平台内部 Web API，自动完成从创建应用到发布上线的全流程。创建的机器人使用飞书 SDK 的长连接（WebSocket）接收事件，无需公网 IP、无需 webhook URL、无需部署服务器。

## 功能

- **一键创建机器人**：自动完成 8 步流程（上传图标 → 创建应用 → 获取密钥 → 启用机器人 → 导入权限 → 订阅事件 → 创建版本 → 发送通知）
- **长连接模式**：机器人通过 WebSocket 接收事件，无需配置回调地址
- **103 项权限**：内置 27 个 tenant 权限 + 76 个 user 权限，覆盖消息、文档、日历、任务等场景
- **3 个事件订阅**：`im.message.receive_v1`、`im.message.reaction.created_v1`、`im.message.reaction.deleted_v1`
- **双模式登录**：GUI 环境打开浏览器，SSH/容器环境终端二维码扫码

## 前置要求

- Node.js >= 18
- Chrome 或 Edge 浏览器（也可通过 `install-browser` 命令自动下载）

## 快速开始

```bash
# 方式一：npx 直接运行（推荐）
npx feishu-bot-creator create-bot -n "my-bot"

# 方式二：全局安装
npm i -g feishu-bot-creator
feishu-bot-creator create-bot -n "my-bot"

# 方式三：克隆后使用 run.sh
git clone https://github.com/nicepkg/feishu-bot-creator.git
cd feishu-bot-creator
npm install
./run.sh "my-bot" "我的机器人描述"
```

### 示例输出

```
正在启动无头浏览器...
请使用飞书 APP 扫描终端中的二维码完成登录
登录成功！正在获取凭证...
凭证获取成功！
[1/8] 上传应用图标...
[2/8] 创建应用 "my-bot"...
  App ID: cli_a925xxxxxxxxxx
  https://open.feishu.cn/app/cli_a925xxxxxxxxxx
[3/8] 获取 App Secret...
  App Secret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
[4/8] 启用机器人功能...
[5/8] 导入权限列表 (27 tenant + 76 user)...
[6/8] 添加事件订阅 (receive + reaction.created + reaction.deleted)...
[7/8] 获取用户信息并创建版本 0.0.1...
[8/8] 发送飞书通知...
  已发送成功通知到飞书

============================================================
  机器人创建成功！
============================================================
  名称:       my-bot
  App ID:     cli_a925xxxxxxxxxx
  App Secret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  应用链接:   https://open.feishu.cn/app/cli_a925xxxxxxxxxx
============================================================
```

## 命令

### 登录

每次运行命令时自动触发登录，不持久化凭证。

- **有 UI 环境**（`--gui` 或 `LARK_GUI=1`）：自动打开 Chrome/Edge，在浏览器中完成登录
- **无 UI 环境**（SSH、容器、云 IDE）：启动无头浏览器，在终端打印二维码，使用飞书 APP 扫码登录

### `create-bot`

一键创建飞书机器人应用，自动完成以下 8 步：

1. 上传应用图标
2. 创建应用 → 获取 App ID
4. 启用机器人能力
5. 导入权限（27 tenant + 76 user）
6. 订阅事件（receive + reaction.created + reaction.deleted）
7. 创建版本 0.0.1 并提交发布
8. 发送飞书消息通知创建者

```bash
# 基本用法
npx feishu-bot-creator create-bot -n "my-bot"

# 指定描述和超时时间
npx feishu-bot-creator create-bot -n "my-bot" -d "这是一个测试机器人" -t 300

# 强制使用 GUI 模式打开浏览器
npx feishu-bot-creator create-bot -n "my-bot" --gui

# 传递浏览器额外参数
npx feishu-bot-creator create-bot -n "my-bot" --browser-args "--no-sandbox,--disable-setuid-sandbox"
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-n, --name <name>` | 应用名称 | `bot` |
| `-d, --desc <desc>` | 应用描述 | 同 name |
| `-t, --timeout <seconds>` | 登录超时时间（秒） | 120 |
| `--browser-args <args>` | 浏览器额外参数（逗号分隔） | - |
| `--gui` | 强制使用 GUI 模式打开浏览器 | - |

### `apps`

列出当前账号下的所有应用。

```bash
npx feishu-bot-creator apps
```

### `install-browser`

自动下载 Chrome for Testing 浏览器。

```bash
npx feishu-bot-creator install-browser
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `CHROME_PATH` | 指定浏览器可执行文件路径 |
| `LARK_HEADLESS=1` | 强制使用无头模式（终端二维码登录） |
| `LARK_GUI=1` | 强制使用 GUI 模式（打开浏览器窗口） |
| `DEBUG=1` | 输出调试信息（CSRF token、cookies 等） |

## 浏览器查找顺序

1. `CHROME_PATH` 环境变量
2. 系统安装的 Chrome（含 Canary、Chromium）
3. 系统安装的 Edge
4. 通过 `install-browser` 下载的 Chrome

支持 macOS、Linux、Windows 三平台。

## 项目结构

```
src/
  index.ts            # CLI 入口，命令注册
  types.ts            # 类型定义
  browser.ts          # 浏览器登录（GUI + 无头二维码）
  browser-install.ts  # Chrome for Testing 下载管理
  api.ts              # 飞书开放平台 API 调用
  create-bot.ts       # 一键创建机器人（8 步流程）
  default-image.ts    # 默认应用图标
  platform.ts         # 平台相关工具函数
run.sh                # 快捷脚本
```

## 工作原理

该工具通过 Puppeteer 逆向调用飞书开放平台的内部 Web API，模拟用户在浏览器中的操作流程：

1. 启动浏览器（GUI 或无头模式）
2. 捕获飞书开放平台登录凭证（cookie、CSRF token）
3. 自动执行 8 步机器人创建流程
4. 生成 App ID 和 App Secret

创建的机器人使用飞书 SDK 的长连接模式（WebSocket）接收事件推送。开发者在代码中只需要：

```typescript
import * as lark from "@larksuiteoapi/node-sdk";

const client = new lark.Client({ appId: "cli_xxxxx", appSecret: "xxxxx" });

// 启动长连接接收事件
new lark.ws.Client({ appId: "cli_xxxxx", appSecret: "xxxxx",
  eventDispatcher: new lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => console.log(data),
  }),
}).start();
```

无需配置公网回调地址，机器人可直接在本地或内网环境中运行。

## License

MIT
