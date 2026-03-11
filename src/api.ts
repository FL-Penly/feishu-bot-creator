import type { Credentials, AppInfo, FeishuApiResponse } from "./types.js";
import { apiBase, openBaseUrl, appPageUrl } from "./platform.js";
const PAGE_SIZE = 50;

interface AppListData {
  apps: AppInfo[];
  totalCount: number;
}

/** 获取所有应用（自动分页） */
export async function fetchAllApps(creds: Credentials): Promise<AppInfo[]> {
  const allApps: AppInfo[] = [];
  let cursor = 0;

  while (true) {
    const data = await fetchAppList(creds, cursor, PAGE_SIZE);

    if (data.code !== 0) {
      throw new Error(`API 错误: code=${data.code}, msg=${data.msg || "未知错误"}`);
    }

    const apps = data.data?.apps || [];
    allApps.push(...apps);

    const totalCount = data.data?.totalCount || 0;
    cursor += PAGE_SIZE;

    if (allApps.length >= totalCount || apps.length === 0) break;
    if (cursor > 10000) break; // 安全阈值
  }

  return allApps;
}

async function fetchAppList(
  creds: Credentials,
  cursor: number,
  count: number
): Promise<FeishuApiResponse<AppListData>> {
  const url = `${apiBase()}/app/list`;
  const body = {
    Count: count,
    Cursor: cursor,
    QueryFilter: { filterAppSceneTypeList: [0] },
    OrderBy: 0,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: creds.cookieString,
      ...(creds.csrfToken ? { "x-csrf-token": creds.csrfToken } : {}),
      "x-timezone-offset": "-480",
      Origin: openBaseUrl(),
      Referer: appPageUrl(),
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as FeishuApiResponse<AppListData>;
}
