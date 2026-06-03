/**
 * 推送模块 — 飞书消息组装与发送
 *
 * 异动检测后批量拉取 app-info，填充元数据，组装消息推送
 */

import type { RankChange } from "./types.js";
import type { RawAnomaly } from "./comparator.js";
import { fetchAppInfoBatch } from "./fetcher.js";
import { groupAndSortAnomalies } from "./comparator.js";
import { getAppStoreUrl, MARKETS, MAX_RETRIES } from "./config.js";

/** 飞书 Webhook URL */
function getWebhookUrl(): string {
  const url = process.env.FEISHU_WEBHOOK_URL;
  if (!url) throw new Error("缺少环境变量 FEISHU_WEBHOOK_URL");
  return url;
}

/** 带元数据的完整异动 App */
interface ResolvedAnomaly {
  country: string;
  countryName: string;
  appId: number;
  appName: string;
  publisherName: string;
  category: string;
  currentRank: number;
  appStoreUrl: string;
  changes: RankChange[];
  emoji: string;
}

/**
 * 批量拉取元数据，将 RawAnomaly 填充为 ResolvedAnomaly
 */
export async function resolveAnomalies(
  rawAnomalies: RawAnomaly[]
): Promise<ResolvedAnomaly[]> {
  if (rawAnomalies.length === 0) return [];

  // 收集所有需要查询的 app_id（去重）
  const appIds = [...new Set(rawAnomalies.map((a) => a.appId))];

  console.log(`[reporter] 批量拉取 ${appIds.length} 个 App 详情...`);
  const appInfoMap = await fetchAppInfoBatch(appIds);
  console.log(`[reporter] 成功获取 ${appInfoMap.size} 个 App 详情`);

  return rawAnomalies.map((raw) => {
    const info = appInfoMap.get(raw.appId);
    const category =
      info?.categories?.find((c) => c.primary)?.name ||
      info?.categories?.[0]?.name ||
      "未知分类";

    return {
      country: raw.country,
      countryName: MARKETS[raw.country] || raw.country,
      appId: raw.appId,
      appName: info?.app_name || `App ${raw.appId}`,
      publisherName: info?.publisher_name || "未知",
      category,
      currentRank: raw.currentRank,
      appStoreUrl: getAppStoreUrl(raw.appId, raw.country),
      changes: raw.changes,
      emoji: raw.currentRank <= 10 ? "🚀" : "⬆️",
    };
  });
}

/**
 * 格式化单个变化窗口为文本
 */
function formatChange(c: RankChange): string {
  if (c.oldRank === null || c.change === null) {
    return `${c.windowLabel}(—)—`;
  }
  const arrow = c.change > 0 ? "↑" : c.change < 0 ? "↓" : "→";
  const fire = c.triggered ? "🔥" : "";
  return `${c.windowLabel}(${c.oldRank})${arrow}${Math.abs(c.change)}${fire}`;
}

/**
 * 生成一条 App 异动行
 */
function formatAnomaly(a: ResolvedAnomaly): string {
  const maxChange = Math.max(...a.changes.map((c) => c.change ?? 0));
  const changeDisplay = maxChange > 0 ? `↑${maxChange}` : "";

  const lines: string[] = [];
  lines.push(
    `  ${a.emoji} **${a.appName}**  第 ${a.currentRank} 名 ${changeDisplay}  [🔗](${a.appStoreUrl})`
  );

  const changesLine = a.changes.map(formatChange).join("  |  ");
  lines.push(`     ${changesLine}`);

  return lines.join("\n");
}

/**
 * 组装完整飞书消息
 */
export function buildFeishuMessage(
  anomalies: ResolvedAnomaly[],
  date: string
): string {
  if (anomalies.length === 0) return "";

  const groups = groupAndSortAnomalies(anomalies);
  const lines: string[] = [];

  lines.push(`📊 **App 下载榜异动警报** | ${date}\n`);

  for (const [key, apps] of groups) {
    const [country, category] = key.split("::");
    const flag = getCountryFlag(country);
    lines.push(`${flag} ${country} · ${category}`);

    for (const app of apps) {
      lines.push(formatAnomaly(app));
      lines.push("");
    }
  }

  lines.push(`---`);
  lines.push(`共 ${anomalies.length} 个 App 触发异动 · ${date}`);

  return lines.join("\n");
}

/** 国家代码 → emoji 国旗 */
function getCountryFlag(code: string): string {
  const flags: Record<string, string> = {
    CN: "🇨🇳", TW: "🇹🇼", JP: "🇯🇵", KR: "🇰🇷",
    SA: "🇸🇦", TR: "🇹🇷", RU: "🇷🇺", DE: "🇩🇪",
    FR: "🇫🇷", IT: "🇮🇹", US: "🇺🇸",
  };
  return flags[code] || "🏳️";
}

/**
 * 发送飞书消息
 */
export async function sendFeishuMessage(message: string): Promise<void> {
  if (!message) {
    console.log("[reporter] 无消息需要发送");
    return;
  }

  const webhookUrl = getWebhookUrl();

  const payload = {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: "📊 App 下载榜异动警报" },
        template: "blue" as const,
      },
      elements: [
        {
          tag: "markdown",
          content: message,
        },
      ],
    },
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const result = (await res.json()) as {
        StatusCode?: number;
        StatusMessage?: string;
      };
      if (result.StatusCode !== 0) {
        throw new Error(
          `飞书返回错误: ${result.StatusMessage || "未知错误"}`
        );
      }

      console.log("[reporter] 飞书消息发送成功");
      return;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(
        `[reporter] 发送失败 (第${attempt}次重试): ${(err as Error).message}`
      );
      await new Promise((r) =>
        setTimeout(r, 1000 * Math.pow(2, attempt - 1))
      );
    }
  }
}
