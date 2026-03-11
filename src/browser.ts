import puppeteer, { type Page, type Browser as PuppeteerBrowser } from "puppeteer-core";
import { existsSync } from "fs";
import { createRequire } from "module";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { getInstalledChromePath } from "./browser-install.js";
import type { Credentials } from "./types.js";
import { loginUrl, appPageUrl, openBaseUrl, apiOpenBaseUrl, accountsHost, appName, apiBase, openDomainHosts } from "./platform.js";

const require = createRequire(import.meta.url);
const jsQR = require("jsqr") as { default: typeof import("jsqr").default } | (typeof import("jsqr"));

// ==================== 常量 ====================

const APP_LIST_API_PATH = "/developers/v1/app/list";
const DEFAULT_LOGIN_TIMEOUT = 2 * 60 * 1000;
const QR_REFRESH_INTERVAL = 60_000;

const DEFAULT_BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
];

// ==================== 浏览器查找 ====================

function getBrowserArgs(extraArgs?: string[]): string[] {
  const args = [...DEFAULT_BROWSER_ARGS];

  const envArgs = process.env["LARK_BROWSER_ARGS"];
  if (envArgs) {
    args.push(...envArgs.split(",").map((a) => a.trim()).filter(Boolean));
  }

  if (extraArgs?.length) {
    args.push(...extraArgs);
  }

  return [...new Set(args)];
}

async function findBrowser(): Promise<string> {
  // 优先使用环境变量
  const envPath = process.env["CHROME_PATH"];
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    // macOS - Chrome
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // macOS - Edge
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // Linux - Chrome
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    // Linux - Edge
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    // Windows - Chrome
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    // Windows - Edge
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // 回退到通过 install-browser 下载的 Chrome
  const installed = await getInstalledChromePath();
  if (installed) return installed;

  throw new Error(
    "未找到浏览器，请运行 feishu-bot install-browser 下载，或设置 CHROME_PATH 环境变量"
  );
}

// ==================== 环境检测 ====================

/** 是否使用 GUI 模式（仅当用户显式指定 LARK_GUI=1 时） */
function shouldUseGUI(): boolean {
  return process.env["LARK_GUI"] === "1";
}

// ==================== 二维码相关 ====================

/** 从页面提取二维码数据（canvas.toDataURL → 元素截图 → 全页截图） */
async function captureQRCode(page: Page): Promise<string | null> {
  const decode = typeof jsQR === "function" ? jsQR : (jsQR as { default: Function }).default;

  // 方法1: 通过 canvas.toDataURL() 直接获取二维码图像数据
  const canvasSelectors = [
    '.newLogin_scan-QR-code canvas',
    '.new-scan-qrcode-container canvas',
    '[class*="qr"] canvas',
    'canvas',
  ];

  for (const selector of canvasSelectors) {
    try {
      const dataUrl = await page.evaluate((sel) => {
        const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
        if (!canvas || canvas.width < 50) return null;
        return canvas.toDataURL('image/png');
      }, selector);

      if (dataUrl) {
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        const pngBuf = Buffer.from(base64, 'base64');
        const png = PNG.sync.read(pngBuf);
        const code = decode(new Uint8ClampedArray(png.data), png.width, png.height);
        if (code?.data) {
          if (process.env["DEBUG"]) {
            console.error(`[DEBUG] QR found via canvas.toDataURL: ${selector}`);
          }
          return code.data;
        }
      }
    } catch {
      // 继续尝试下一个选择器
    }
  }

  // 方法2: 元素级截图（适用于 img 元素）
  const imgSelectors = [
    '.newLogin_scan-QR-code img',
    '[class*="qrcode"] img',
    '[class*="qr-code"] img',
    'img[class*="qrcode"]',
  ];

  for (const selector of imgSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        const shot = Buffer.from((await el.screenshot()) as Uint8Array);
        const png = PNG.sync.read(shot);
        const code = decode(new Uint8ClampedArray(png.data), png.width, png.height);
        if (code?.data) {
          if (process.env["DEBUG"]) {
            console.error(`[DEBUG] QR found via element screenshot: ${selector}`);
          }
          return code.data;
        }
      }
    } catch {
      // 继续尝试
    }
  }

  // 方法3: 全页截图后解码（回退方案）
  try {
    const screenshot = Buffer.from((await page.screenshot()) as Uint8Array);
    const png = PNG.sync.read(screenshot);
    const code = decode(new Uint8ClampedArray(png.data), png.width, png.height);
    if (code?.data) {
      if (process.env["DEBUG"]) {
        console.error("[DEBUG] QR found via full page screenshot");
      }
      return code.data;
    }
  } catch (err) {
    if (process.env["DEBUG"]) {
      console.error(`[DEBUG] Full page QR extraction failed: ${err}`);
    }
  }

  return null;
}

/** 在终端打印二维码 */
async function printQRToTerminal(data: string): Promise<void> {
  const text = await QRCode.toString(data, { type: "terminal", small: true });
  console.log(text);
}

/** 尝试切换到二维码扫码登录模式 */
async function tryActivateQRLogin(page: Page): Promise<void> {
  const selectors = [
    '.switch-login-mode-box',        // Lark 页面切换按钮
    '::-p-text(扫码登录)',
    '::-p-text(二维码登录)',
    '::-p-text(Scan QR Code)',
    '[class*="qrcode-switch"]',
    '[class*="qr-switch"]',
    '[class*="scan-switch"]',
    '[data-testid="qrcode-login"]',
  ];

  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.click();
        await new Promise((r) => setTimeout(r, 2000));
        return;
      }
    } catch {
      // 继续尝试下一个选择器
    }
  }
}

// ==================== 登录等待 ====================

/** 等待用户在浏览器中完成登录（检测 session cookie） */
async function waitForLogin(page: Page, timeout: number): Promise<void> {
  const startTime = Date.now();
  const hosts = openDomainHosts();

  while (Date.now() - startTime < timeout) {
    const url = page.url();
    // 检测是否已跳转到开放平台域名（Lark 有两个域名：larksuite.com 和 larkoffice.com）
    if (hosts.some(h => url.includes(h))) {
      // 优先从最终域名获取 cookie，回退到当前页面域名
      const cookies = await page.cookies(openBaseUrl(), `https://${hosts[hosts.length - 1]}`);
      if (cookies.some((c) => c.name === "session")) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`登录超时（${Math.round(timeout / 1000)}秒），请重试`);
}

// ==================== 凭证获取 ====================

/** 登录完成后获取凭证（cookies + CSRF token） */
async function captureCredentials(page: Page): Promise<Credentials> {
  // 监听 API 请求，同时捕获 x-csrf-token header 和请求中的完整 cookie
  // 飞书/Lark 的 CSRF cookie 可能设置了特定 path，page.cookies() 拿不到
  // 但浏览器发请求时会带上，所以从拦截的请求中提取
  let csrfResolved = false;
  let capturedRequestCookie = "";
  const allApiUrls: string[] = []; // DEBUG: 记录所有 API 请求

  const platformDomain = openBaseUrl().replace("https://", "");
  // Lark 的开发者后台可能在另一个域名上提供 API
  const allOpenDomains = openDomainHosts();

  const csrfPromise = new Promise<string>((resolve) => {
    const handler = (response: { request(): { method(): string; url(): string; headers(): Record<string, string> }; status(): number }) => {
      const request = response.request();
      const url = request.url();
      const method = request.method();

      // DEBUG: 记录所有非静态资源请求
      if (process.env["DEBUG"] && (method === "POST" || url.includes("/developers/") || url.includes("/api/"))) {
        allApiUrls.push(`${method} ${response.status()} ${url.substring(0, 150)}`);
      }

      // 匹配任何开放平台域名的请求（兼容 Lark 多域名）
      const matchesDomain = allOpenDomains.some(h => url.includes(h));
      if (!matchesDomain) return;

      // 从 API 请求中捕获完整 cookie（包含 path 限定的 cookie）
      const cookie = request.headers()["cookie"] || "";
      if (cookie && url.includes("/developers/")) {
        capturedRequestCookie = cookie;
      }

      // 只在找到非空 x-csrf-token 时 resolve（空值不算捕获成功）
      const token = request.headers()["x-csrf-token"];
      if (token && !csrfResolved) {
        capturedRequestCookie = cookie || capturedRequestCookie;
        csrfResolved = true;
        page.off("response", handler);

        if (process.env["DEBUG"]) {
          const csrfParts = capturedRequestCookie.split("; ").filter((c) => c.includes("csrf"));
          console.error(`[DEBUG] Intercepted CSRF — url: ${url.substring(0, 100)}`);
          console.error(`[DEBUG] x-csrf-token: ${token.substring(0, 30)}...`);
          console.error(`[DEBUG] CSRF cookies in request: ${csrfParts.join(", ") || "NONE"}`);
        }

        resolve(token);
      }
    };

    page.on("response", handler);

    // 超时回退
    setTimeout(() => {
      if (!csrfResolved) {
        csrfResolved = true;
        page.off("response", handler);
        resolve("__fallback__");
      }
    }, 15000);
  });

  // 导航到应用列表页，触发 API 请求
  await page.goto(appPageUrl(), { waitUntil: "networkidle2" });
  let csrfToken = await csrfPromise;

  if (process.env["DEBUG"] && allApiUrls.length > 0) {
    console.error("[DEBUG] All API-like requests during page load:");
    for (const u of allApiUrls) console.error(`  ${u}`);
  }

  // 诊断：检查页面中嵌入的 CSRF token（meta tag、window 全局变量、script 内容）
  if (process.env["DEBUG"]) {
    const pageCSRF = await page.evaluate(() => {
      const results: string[] = [];
      // Check meta tags
      document.querySelectorAll('meta').forEach(m => {
        const name = (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase();
        if (name.includes('csrf') || name.includes('token')) {
          results.push(`meta[${name}]=${m.getAttribute('content')?.substring(0, 40)}`);
        }
      });
      // Check window globals containing csrf
      for (const key of Object.getOwnPropertyNames(window)) {
        try {
          if (key.toLowerCase().includes('csrf') && typeof (window as any)[key] === 'string') {
            results.push(`window.${key}=${String((window as any)[key]).substring(0, 40)}`);
          }
        } catch {}
      }
      // Check all cookies visible to JS
      const cookieParts = document.cookie.split('; ').filter(c => c.toLowerCase().includes('csrf'));
      results.push(`document.cookie csrf parts: [${cookieParts.map(c => c.split('=')[0]).join(', ')}]`);
      return results;
    });
    console.error(`[DEBUG] Page CSRF diagnostic: ${JSON.stringify(pageCSRF)}`);
    // Check response Set-Cookie headers from intercepted responses
    const apiCookiesAtApiPath = await page.cookies(`${apiBase()}/app/list`);
    console.error(`[DEBUG] Cookies at API path: ${apiCookiesAtApiPath.map(c => `${c.name}(httpOnly=${c.httpOnly},path=${c.path})`).join(', ')}`);
  }

  // Lark 的 SPA 在页面加载时不会立即发起 API 请求（只有 2 个 GET），
  // 导致 x-csrf-token 无法通过请求拦截获取。
  // 尝试多种方式获取正确的 CSRF token：
  if (!csrfToken || csrfToken === "__fallback__") {
    // 方式1: 轮询 window.csrfToken（SPA 异步初始化后会设置）
    const pollEnd = Date.now() + 10000;
    while (Date.now() < pollEnd) {
      const windowCsrf = await page.evaluate(() => {
        try {
          const val = (window as any).csrfToken;
          if (typeof val === 'string' && val.length > 10) return val;
        } catch {}
        return null;
      });
      if (windowCsrf) {
        csrfToken = windowCsrf;
        if (process.env["DEBUG"]) {
          console.error(`[DEBUG] Got CSRF from window.csrfToken: ${csrfToken.substring(0, 40)}...`);
        }
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // 方式2: 浏览器侧 fetch 测试，同时测试不同域名和 CSRF token 组合
    if (!csrfToken || csrfToken === "__fallback__") {
      if (process.env["DEBUG"]) {
        console.error("[DEBUG] window.csrfToken not found after 10s, testing browser-side fetch...");
      }

      // 传入所有可能的 API 域名供浏览器上下文测试
      const altDomains = allOpenDomains.filter(h => h !== platformDomain);
      const browserTest = await page.evaluate(async (altHosts: string[]) => {
        const body = JSON.stringify({ Count: 1, Cursor: 0, QueryFilter: { filterAppSceneTypeList: [0] }, OrderBy: 0 });
        const results: Array<{ desc: string; status: number; body: string }> = [];

        // 收集可用的 CSRF 值
        const swpCookie = document.cookie.split('; ').find(c => c.startsWith('swp_csrf_token='));
        const swpVal = swpCookie?.split('=').slice(1).join('=');

        // 测试矩阵：域名 × CSRF token
        const testUrls = [
          { desc: 'current-domain', url: '/developers/v1/app/list' },
          ...altHosts.map(h => ({ desc: h, url: `https://${h}/developers/v1/app/list` })),
        ];

        for (const endpoint of testUrls) {
          // 先不带 x-csrf-token 头测试
          try {
            const res = await fetch(endpoint.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body,
            });
            const text = await res.text();
            results.push({ desc: `${endpoint.desc} no-csrf`, status: res.status, body: text.substring(0, 200) });
            if (res.ok) continue; // 这个域名不需要 CSRF，继续测下一个
          } catch (e) {
            results.push({ desc: `${endpoint.desc} no-csrf`, status: -1, body: String(e).substring(0, 150) });
          }

          // 带 swp_csrf_token 测试
          if (swpVal) {
            try {
              const res = await fetch(endpoint.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-csrf-token': swpVal },
                credentials: 'include',
                body,
              });
              const text = await res.text();
              results.push({ desc: `${endpoint.desc} swp_csrf`, status: res.status, body: text.substring(0, 200) });
            } catch (e) {
              results.push({ desc: `${endpoint.desc} swp_csrf`, status: -1, body: String(e).substring(0, 150) });
            }
          }
        }
        return results;
      }, altDomains);

      if (process.env["DEBUG"]) {
        console.error("[DEBUG] Browser multi-domain CSRF test results:");
        for (const r of browserTest) {
          console.error(`  [${r.desc}] status=${r.status} body=${r.body}`);
        }
      }

      // 查找哪个域名 + token 组合成功（status 200）
      const passed = browserTest.find(r => r.status === 200);
      if (passed) {
        if (process.env["DEBUG"]) {
          console.error(`[DEBUG] Working API endpoint found: ${passed.desc}`);
        }
        if (passed.desc.includes('no-csrf')) {
          // 读端不需要 CSRF，但写端（如 upload/image）仍需要。
          // 标记为 __use_swp_csrf__，后续从 API 域名的 swp_csrf_token cookie 提取。
          csrfToken = "__use_swp_csrf__";
        }
      }

      // 追加：测试写端点 CSRF 校验（用空 FormData POST 到 upload/image）
      if (passed && passed.desc.includes('no-csrf')) {
        const writeTestUrl = passed.desc === 'current-domain'
          ? '/developers/v1/app/upload/image'
          : `https://${passed.desc}/developers/v1/app/upload/image`;
        const writeResults = await page.evaluate(async (url: string) => {
          const swpCookie = document.cookie.split('; ').find(c => c.startsWith('swp_csrf_token='));
          const swpVal = swpCookie?.split('=').slice(1).join('=') || '';
          const larkCookie = document.cookie.split('; ').find(c => c.startsWith('lark_oapi_csrf_token='));
          const larkVal = larkCookie?.split('=').slice(1).join('=') || '';
          const results: Array<{ desc: string; status: number; body: string }> = [];
          // 测试1: swp_csrf_token 作为 x-csrf-token
          if (swpVal) {
            try {
              const res = await fetch(url, {
                method: 'POST', credentials: 'include',
                headers: { 'x-csrf-token': swpVal },
                body: new FormData()
              });
              results.push({ desc: 'write-swp', status: res.status, body: (await res.text()).substring(0, 200) });
            } catch (e) { results.push({ desc: 'write-swp', status: -1, body: String(e).substring(0, 150) }); }
          }
          // 测试2: lark_oapi_csrf_token 作为 x-csrf-token（如果 document.cookie 里有的话）
          if (larkVal) {
            try {
              const res = await fetch(url, {
                method: 'POST', credentials: 'include',
                headers: { 'x-csrf-token': larkVal },
                body: new FormData()
              });
              results.push({ desc: 'write-lark', status: res.status, body: (await res.text()).substring(0, 200) });
            } catch (e) { results.push({ desc: 'write-lark', status: -1, body: String(e).substring(0, 150) }); }
          }
          // 测试3: 不带 x-csrf-token
          try {
            const res = await fetch(url, {
              method: 'POST', credentials: 'include',
              body: new FormData()
            });
            results.push({ desc: 'write-none', status: res.status, body: (await res.text()).substring(0, 200) });
          } catch (e) { results.push({ desc: 'write-none', status: -1, body: String(e).substring(0, 150) }); }
          return { results, swpVal: swpVal?.substring(0, 20), larkVal: larkVal?.substring(0, 20) };
        }, writeTestUrl);

        if (process.env['DEBUG']) {
          console.error(`[DEBUG] Write endpoint CSRF test (from browser context):`);
          console.error(`[DEBUG]   swp_csrf_token from document.cookie: ${writeResults.swpVal || '(none)'}`);
          console.error(`[DEBUG]   lark_oapi_csrf_token from document.cookie: ${writeResults.larkVal || '(none)'}`);
          for (const r of writeResults.results) {
            console.error(`  [${r.desc}] status=${r.status} body=${r.body}`);
          }
        }

        // 如果浏览器内的写测试找到了能通过 CSRF 的方案
        const writeOk = writeResults.results.find(r => r.status !== 400 || !r.body.includes('csrf'));
        if (writeOk && process.env['DEBUG']) {
          console.error(`[DEBUG] Write endpoint CSRF passed with: ${writeOk.desc}`);
        }
      }
    }
  }

  // fallback：穷举所有 CSRF cookie 来源，按优先级选择
  if (!csrfToken || csrfToken === "__fallback__") {
    if (process.env["DEBUG"]) {
      console.error("[DEBUG] CSRF interception + window.csrfToken both failed, gathering cookies...");
    }

    // 收集所有 CSRF 相关 cookie（来源 + 名称 + 值）
    const csrfSources: Array<{ source: string; name: string; value: string }> = [];

    // 来源1: 已捕获的请求 cookie
    if (capturedRequestCookie) {
      for (const c of capturedRequestCookie.split("; ")) {
        const [name, ...rest] = c.split("=");
        if (name === "lark_oapi_csrf_token" || name === "swp_csrf_token") {
          csrfSources.push({ source: "request_cookie", name, value: rest.join("=") });
        }
      }
    }

    // 来源2: page.cookies() 基础 URL（path=/ 的 cookie）
    const baseCookies = await page.cookies(openBaseUrl());
    for (const c of baseCookies) {
      if (c.name === "lark_oapi_csrf_token" || c.name === "swp_csrf_token") {
        if (!csrfSources.some(s => s.name === c.name)) {
          csrfSources.push({ source: "page_cookies_base", name: c.name, value: c.value });
        }
      }
    }

    // 来源3: page.cookies() API 路径（获取 path 限定的 cookie，如 path=/developers/v1）
    const apiCookies = await page.cookies(`${apiBase()}/app/list`);
    for (const c of apiCookies) {
      if (c.name === "lark_oapi_csrf_token" || c.name === "swp_csrf_token") {
        if (!csrfSources.some(s => s.name === c.name)) {
          csrfSources.push({ source: "page_cookies_api", name: c.name, value: c.value });
        }
      }
    }

    // 来源4: CDP Network.getAllCookies（无视 path/domain 限制）
    try {
      const client = await page.createCDPSession();
      const { cookies: allCdpCookies } = await client.send('Network.getAllCookies') as {
        cookies: Array<{ name: string; value: string; path: string; domain: string }>
      };
      for (const c of allCdpCookies) {
        if (c.name === "lark_oapi_csrf_token" || c.name === "swp_csrf_token") {
          if (!csrfSources.some(s => s.name === c.name && s.value === c.value)) {
            csrfSources.push({ source: `cdp(${c.domain}${c.path})`, name: c.name, value: c.value });
          }
        }
      }
      await client.detach();
    } catch {
      // CDP session might not be available
    }

    if (process.env["DEBUG"]) {
      console.error("[DEBUG] All CSRF cookies found:");
      for (const s of csrfSources) {
        console.error(`  [${s.source}] ${s.name}=${s.value.substring(0, 36)}...`);
      }
    }

    // 优先级：lark_oapi_csrf_token > swp_csrf_token > 任何其他
    const larkOapiToken = csrfSources.find(s => s.name === "lark_oapi_csrf_token");
    const swpToken = csrfSources.find(s => s.name === "swp_csrf_token");
    csrfToken = larkOapiToken?.value || swpToken?.value || "";

    if (process.env["DEBUG"] && csrfToken) {
      const chosen = larkOapiToken ? "lark_oapi_csrf_token" : "swp_csrf_token";
      console.error(`[DEBUG] Selected CSRF token from: ${chosen}`);
    }
  }

  // 获取 cookies：从页面域名和 API 域名（可能不同）合并
  const pageCookies = await page.cookies(openBaseUrl());
  const apiUrl = apiOpenBaseUrl();
  const isSplitDomain = apiUrl !== openBaseUrl();
  const apiCookies = isSplitDomain ? await page.cookies(apiUrl) : [];

  const cookieMap = new Map<string, (typeof pageCookies)[0]>();
  if (isSplitDomain && apiCookies.length > 0) {
    // Lark 分域架构：用 API 域名（larksuite.com）的 cookie 做 session 认证
    for (const c of apiCookies) cookieMap.set(c.name, c);
    // CSRF token：服务端校验的是 login 时存入 session 的值，该值等于页面域名设置的 lark_oapi_csrf_token cookie
    // lark_oapi_csrf_token 在 .larkoffice.com 上（base64 格式），不是 .larksuite.com 的 swp_csrf_token（UUID 格式）
    const pageOapiCsrf = pageCookies.find(c => c.name === 'lark_oapi_csrf_token');
    if (pageOapiCsrf && (!csrfToken || csrfToken === '__use_swp_csrf__' || csrfToken === '__no_csrf_needed__' || csrfToken === '__fallback__')) {
      csrfToken = pageOapiCsrf.value;
      if (process.env['DEBUG']) {
        console.error(`[DEBUG] Extracted lark_oapi_csrf_token from page cookies: ${csrfToken.substring(0, 20)}...`);
      }
    }
  } else {
    // 飞书：页面和 API 同域，合并所有 cookie
    for (const c of pageCookies) cookieMap.set(c.name, c);
    for (const c of apiCookies) cookieMap.set(c.name, c);
  }
  const allCookies = Array.from(cookieMap.values());
  let cookieString = allCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  // 从拦截的请求中合并 puppeteer 捕获不到的 cookie（特定 path 的）
  // Lark 分域模式下跳过：拦截到的 cookie 来自页面域名（larkoffice.com），不应发往 API 域名
  if (capturedRequestCookie && !isSplitDomain) {
    const existingNames = new Set(allCookies.map((c) => c.name));
    const extraCookies = capturedRequestCookie
      .split("; ")
      .filter((c) => {
        const name = c.split("=")[0];
        return !existingNames.has(name);
      });
    if (extraCookies.length > 0) {
      cookieString += "; " + extraCookies.join("; ");
      if (process.env["DEBUG"]) {
        console.error(`[DEBUG] Merged ${extraCookies.length} extra cookies from request: ${extraCookies.map(c => c.split("=")[0]).join(", ")}`);
      }
    }
  }

  // 确保 lark_oapi_csrf_token cookie 存在（服务端 CSRF 校验硬编码了这个 cookie 名）
  // 飞书：值来自 lark_oapi_csrf_token cookie 本身
  // Lark：值来自页面域名（.larkoffice.com）的 lark_oapi_csrf_token（服务端 session 存的就是这个值）
  if (csrfToken && csrfToken !== '__fallback__' && csrfToken !== '__use_swp_csrf__' && !cookieString.includes('lark_oapi_csrf_token=')) {
    cookieString += `; lark_oapi_csrf_token=${csrfToken}`;
  }

  if (!csrfToken || csrfToken === '__fallback__' || csrfToken === '__use_swp_csrf__') {
    if (isSplitDomain) {
      console.warn('⚠️ 未从页面 cookie 获取到 lark_oapi_csrf_token，写操作可能失败。请尝试 DEBUG=1 运行以获取诊断信息。');
      csrfToken = '';
    } else {
      console.warn('⚠️ 未能获取 CSRF token，API 调用可能失败。请尝试 DEBUG=1 运行以获取诊断信息。');
      csrfToken = '';
    }
  }

  if (process.env["DEBUG"]) {
    console.error(`[DEBUG] Final CSRF Token: ${csrfToken || "(none - not needed)"}`);
    console.error(`[DEBUG] Page cookies: ${pageCookies.map((c) => `${c.name}(${c.domain})`).join(", ")}`);
    if (apiCookies.length > 0) {
      console.error(`[DEBUG] API cookies: ${apiCookies.map((c) => `${c.name}(${c.domain})`).join(", ")}`);
    }
    console.error(`[DEBUG] Full cookie string length: ${cookieString.length}`);
  }

  console.log("凭证获取成功！");
  return { cookieString, csrfToken, savedAt: Date.now() };
}

// ==================== 登录入口 ====================

/** 终端二维码扫码登录（默认模式，无需 GUI） */
async function loginHeadlessWithQR(
  timeout: number,
  extraBrowserArgs?: string[]
): Promise<Credentials> {
  const chromePath = process.env["CHROME_PATH"] || (await findBrowser());

  console.log("正在启动无头浏览器...");
  console.log(`请使用${appName()} APP 扫描终端中的二维码完成登录\n`);
  const browser: PuppeteerBrowser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: getBrowserArgs(extraBrowserArgs),
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    const page = await browser.newPage();
    await page.goto(loginUrl(), { waitUntil: "networkidle2" });

    // 等待页面渲染完成
    await new Promise((r) => setTimeout(r, 2000));

    // 尝试截取二维码
    let qrData = await captureQRCode(page);
    if (!qrData) {
      await tryActivateQRLogin(page);
      await new Promise((r) => setTimeout(r, 2000));
      qrData = await captureQRCode(page);
    }

    if (!qrData) {
      throw new Error(
        "无法从登录页面提取二维码。请尝试设置 LARK_GUI=1 强制使用 GUI 模式登录。"
      );
    }

    console.log(`请使用${appName()} APP 扫描以下二维码登录：\n`);
    await printQRToTerminal(qrData);
    console.log("等待扫码...\n");

    // 等待登录，同时监测二维码刷新
    const startTime = Date.now();
    let lastQR = qrData;
    let lastQRCheck = Date.now();

    while (Date.now() - startTime < timeout) {
      // 检测是否已登录（兼容 Lark 的两个域名）
      const url = page.url();
      const hosts = openDomainHosts();
      if (hosts.some(h => url.includes(h))) {
        const cookies = await page.cookies(openBaseUrl(), `https://${hosts[hosts.length - 1]}`);
        if (cookies.some((c) => c.name === "session")) {
          break;
        }
      }

      // 仍在登录页时定期检查二维码是否刷新
      if (
        url.includes(accountsHost()) &&
        Date.now() - lastQRCheck > QR_REFRESH_INTERVAL
      ) {
        lastQRCheck = Date.now();
        try {
          const newQR = await captureQRCode(page);
          if (newQR && newQR !== lastQR) {
            lastQR = newQR;
            console.log("\n二维码已刷新，请重新扫描：\n");
            await printQRToTerminal(newQR);
            console.log("等待扫码...\n");
          } else if (!newQR) {
            // 二维码可能已过期，刷新页面
            console.log("\n二维码可能已过期，正在刷新...\n");
            await page.goto(loginUrl(), { waitUntil: "networkidle2" });
            await new Promise((r) => setTimeout(r, 2000));
            const refreshedQR = await captureQRCode(page);
            if (refreshedQR) {
              lastQR = refreshedQR;
              console.log(`请使用${appName()} APP 扫描以下新二维码：\n`);
              await printQRToTerminal(refreshedQR);
              console.log("等待扫码...\n");
            }
          }
        } catch {
          // 忽略二维码刷新错误
        }
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    if (Date.now() - startTime >= timeout) {
      throw new Error(`登录超时（${Math.round(timeout / 1000)}秒），请重试`);
    }

    console.log("\n登录成功！正在获取凭证...");
    return await captureCredentials(page);
  } finally {
    await browser.close();
  }
}

/** GUI 环境：打开 Chrome 浏览器让用户登录 */
async function loginWithBrowser(
  timeout: number,
  extraBrowserArgs?: string[]
): Promise<Credentials> {
  const chromePath = process.env["CHROME_PATH"] || (await findBrowser());

  console.log("正在启动 Chrome...");
  console.log(`请在浏览器中完成${appName()}登录，登录成功后会自动获取凭证\n`);

  const browser: PuppeteerBrowser = await puppeteer.launch({
    headless: false,
    executablePath: chromePath,
    args: getBrowserArgs(extraBrowserArgs),
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    const page = await browser.newPage();
    await page.goto(loginUrl(), { waitUntil: "networkidle2" });

    console.log("等待登录完成...");
    await waitForLogin(page, timeout);

    console.log("\n登录成功！正在获取凭证...");
    return await captureCredentials(page);
  } finally {
    await browser.close();
  }
}

/**
 * 启动浏览器让用户登录，并捕获凭证（cookies + CSRF token）
 * 默认使用终端二维码模式（headless），设置 LARK_GUI=1 或传入 --gui 切换为 GUI 浏览器
 */
export async function loginAndCapture(
  timeoutMs: number = DEFAULT_LOGIN_TIMEOUT,
  extraBrowserArgs?: string[]
): Promise<Credentials> {
  if (shouldUseGUI()) {
    return loginWithBrowser(timeoutMs, extraBrowserArgs);
  }
  return loginHeadlessWithQR(timeoutMs, extraBrowserArgs);
}
