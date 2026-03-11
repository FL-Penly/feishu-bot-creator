/** 平台类型：飞书（中国）/ Lark（海外） */
export type Platform = "feishu" | "lark";

const DOMAINS: Record<Platform, {
  accounts: string;
  /** SPA 页面域名 */
  open: string;
  /** API 域名（Lark 的 API 在 larksuite.com 上，页面在 larkoffice.com 上） */
  apiOpen?: string;
  passport: string;
  /** 登录后的重定向域名（Lark 会从 larksuite.com 跳转到 larkoffice.com） */
  loginRedirect?: string;
}> = {
  feishu: {
    accounts: "accounts.feishu.cn",
    open: "open.feishu.cn",
    passport: "passport.feishu.cn",
  },
  lark: {
    accounts: "accounts.larksuite.com",
    // Lark 开发者后台页面在 larkoffice.com（open.larksuite.com 会 302 跳转过来）
    open: "open.larkoffice.com",
    // 但 API 在 larksuite.com 上（/developers/v1/... 路径在 larkoffice.com 上返回 404）
    apiOpen: "open.larksuite.com",
    passport: "passport.larksuite.com",
    loginRedirect: "open.larksuite.com",
  },
};

let _platform: Platform = "feishu";

export function setPlatform(p: Platform): void {
  _platform = p;
}

export function getPlatform(): Platform {
  return _platform;
}

/** 页面域名：https://open.feishu.cn 或 https://open.larkoffice.com */
export function openBaseUrl(): string {
  return `https://${DOMAINS[_platform].open}`;
}

/** API 域名：飞书与页面相同；Lark 为 https://open.larksuite.com */
export function apiOpenBaseUrl(): string {
  return `https://${DOMAINS[_platform].apiOpen || DOMAINS[_platform].open}`;
}

/** https://accounts.feishu.cn 或 https://accounts.larksuite.com */
export function accountsHost(): string {
  return DOMAINS[_platform].accounts;
}

/** https://passport.feishu.cn 或 https://passport.larksuite.com */
export function passportBaseUrl(): string {
  return `https://${DOMAINS[_platform].passport}`;
}

/** 开放平台 API 前缀（Lark: open.larksuite.com/developers/v1） */
export function apiBase(): string {
  return `${apiOpenBaseUrl()}/developers/v1`;
}

/** 登录页 URL（redirect_uri 用 loginRedirect 或 open 域名） */
export function loginUrl(): string {
  const redirectHost = DOMAINS[_platform].loginRedirect || DOMAINS[_platform].open;
  return `https://${DOMAINS[_platform].accounts}/accounts/page/login?app_id=7&no_trap=1&redirect_uri=${encodeURIComponent(`https://${redirectHost}/`)}`;
}

/** 应用列表页 */
export function appPageUrl(): string {
  return `${openBaseUrl()}/app`;
}

/** 显示名称："飞书" 或 "Lark" */
export function appName(): string {
  return _platform === "lark" ? "Lark" : "飞书";
}

/** 登录成功后可能出现的域名列表（用于检测是否已跳转到开放平台） */
export function openDomainHosts(): string[] {
  const hosts = [DOMAINS[_platform].open];
  if (DOMAINS[_platform].loginRedirect) {
    hosts.push(DOMAINS[_platform].loginRedirect!);
  }
  return hosts;
}
