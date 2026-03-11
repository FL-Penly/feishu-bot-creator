import * as path from "path";
import * as os from "os";
import { install, resolveBuildId, detectBrowserPlatform, Browser, type InstalledBrowser } from "@puppeteer/browsers";

const CACHE_DIR = path.join(os.homedir(), ".feishu-bot-creator", "browsers");

/**
 * 下载 Chrome for Testing 到本地缓存
 * 适用于服务器等没有预装浏览器的环境
 */
export async function downloadChrome(): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error("无法检测当前操作系统平台");
  }

  console.log("正在解析最新 Chrome 版本...");
  const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
  console.log(`目标版本: Chrome ${buildId} (${platform})`);
  console.log(`缓存目录: ${CACHE_DIR}`);
  console.log("正在下载，请稍候...\n");

  const result: InstalledBrowser = await install({
    browser: Browser.CHROME,
    buildId,
    cacheDir: CACHE_DIR,
  });

  console.log(`\n下载完成: ${result.executablePath}`);
  return result.executablePath;
}

/**
 * 获取通过 install-browser 下载的 Chrome 路径
 * 如果没有下载过，返回 null
 */
export async function getInstalledChromePath(): Promise<string | null> {
  const platform = detectBrowserPlatform();
  if (!platform) return null;

  try {
    const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");

    // 拼出预期的安装路径并检查
    const { computeExecutablePath } = await import("@puppeteer/browsers");
    const execPath = computeExecutablePath({
      browser: Browser.CHROME,
      buildId,
      cacheDir: CACHE_DIR,
    });

    const fs = await import("fs");
    if (fs.existsSync(execPath)) {
      return execPath;
    }
  } catch {
    // 未安装或版本变动，忽略
  }

  return null;
}
