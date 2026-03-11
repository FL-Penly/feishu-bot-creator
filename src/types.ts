/** 登录后捕获的凭证 */
export interface Credentials {
  cookieString: string;
  csrfToken: string;
  savedAt: number;
}

/** 应用列表项 */
export interface AppInfo {
  appID: string;
  name: string;
  desc: string;
  version: string;
  appStatus: number;
  ability: string[];
}

/** create-bot 命令参数 */
export interface CreateBotOptions {
  name: string;
  desc: string;
}

/** create-bot 执行结果 */
export interface CreateBotResult {
  appId: string;
  appSecret: string;
  versionId: string;
  name: string;
  desc: string;
}

/** 飞书 API 通用响应 */
export interface FeishuApiResponse<T = unknown> {
  code: number;
  msg?: string;
  data: T;
}
