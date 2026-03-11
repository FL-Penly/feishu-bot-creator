#!/usr/bin/env node

import { Command } from "commander";
import { loginAndCapture } from "./browser.js";
import { fetchAllApps } from "./api.js";
import { createBot } from "./create-bot.js";
import { downloadChrome, getInstalledChromePath } from "./browser-install.js";
import type { Credentials, AppInfo } from "./types.js";
import { openBaseUrl } from "./platform.js";
const program = new Command();

program
  .name("feishu-bot-creator")
  .description("飞书开放平台 CLI 工具 —— 一键创建飞书机器人")
  .version("0.1.0");

// ==================== 辅助函数 ====================

/** 每次运行都重新登录获取凭证 */
async function getCredentials(opts: {
  timeout?: string;
  browserArgs?: string;
  gui?: boolean;
}): Promise<Credentials> {
  if (opts.gui) {
    process.env["LARK_GUI"] = "1";
  }
  const extraArgs = opts.browserArgs
    ?.split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  return loginAndCapture(Number(opts.timeout || "120") * 1000, extraArgs);
}

function getStatusText(status: number): string {
  switch (status) {
    case 0:
      return "未发布";
    case 2:
      return "已发布";
    default:
      return `未知(${status})`;
  }
}

function printApps(apps: AppInfo[]): void {
  if (apps.length === 0) {
    console.log("没有找到应用");
    return;
  }

  console.log(`\n共找到 ${apps.length} 个应用:\n`);
  console.log("─".repeat(80));

  for (const app of apps) {
    const status = getStatusText(app.appStatus);
    console.log(`  App ID:   ${app.appID}`);
    console.log(`  名称:     ${app.name}`);
    if (app.desc) {
      console.log(`  描述:     ${app.desc}`);
    }
    if (app.version) {
      console.log(`  版本:     ${app.version}`);
    }
    console.log(`  状态:     ${status}`);
    if (app.ability.length > 0) {
      console.log(`  能力:     ${app.ability.join(", ")}`);
    }
    console.log("─".repeat(80));
  }
}

// ==================== 命令注册 ====================

// apps
program
  .command("apps")
  .description("列出所有应用")
  .option("-t, --timeout <seconds>", "登录超时时间（秒）", "120")
  .option("--browser-args <args>", "额外的浏览器启动参数（逗号分隔）")
  .option("--gui", "使用 GUI 浏览器登录（默认使用终端二维码）")
  .action(async (opts) => {
    try {
      const creds = await getCredentials(opts);
      const apps = await fetchAllApps(creds);
      printApps(apps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n获取应用列表失败: ${msg}`);
      process.exit(1);
    }
  });

// create-bot
program
  .command("create-bot")
  .description("一键创建机器人应用（长连接模式）")
  .option("-n, --name <name>", "应用名称", "bot")
  .option("-d, --desc <desc>", "应用描述")
  .option("-t, --timeout <seconds>", "登录超时时间（秒）", "120")
  .option("--browser-args <args>", "额外的浏览器启动参数（逗号分隔）")
  .option("--gui", "使用 GUI 浏览器登录（默认使用终端二维码）")
  .action(async (opts) => {
    try {
      const creds = await getCredentials(opts);
      const name = opts.name as string;
      const desc = (opts.desc as string) || name;
      const result = await createBot(creds, { name, desc });

      console.log("\n" + "=".repeat(60));
      console.log("  机器人创建成功！");
      console.log("=".repeat(60));
      console.log(`  名称:       ${result.name}`);
      console.log(`  描述:       ${result.desc}`);
      console.log(`  App ID:     ${result.appId}`);
      console.log(`  App Secret: ${result.appSecret}`);
      console.log(`  应用链接:   ${openBaseUrl()}/app/${result.appId}`);
      console.log(
        `  版本链接:   ${openBaseUrl()}/app/${result.appId}/version/${result.versionId}`
      );
      console.log("=".repeat(60));
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n创建机器人失败: ${msg}`);
      process.exit(1);
    }
  });

// install-browser
program
  .command("install-browser")
  .description("下载 Chrome 浏览器（适用于服务器等无浏览器环境）")
  .action(async () => {
    const existing = await getInstalledChromePath();
    if (existing) {
      console.log(`Chrome 已存在: ${existing}`);
      return;
    }

    try {
      const execPath = await downloadChrome();
      console.log(`\nChrome 已就绪: ${execPath}`);
    } catch (err) {
      console.error("下载失败:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
