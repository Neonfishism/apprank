/**
 * 推送模块 — 飞书消息组装与发送
 */

import type { Anomaly, RankChange } from "./types.js";
import { MAX_RETRIES } from "./config.js";

/** 国家 → 国旗 */
const FLAGS: Record<string, string> = {
  CN: "🇨🇳", TW: "🇹🇼", JP: "🇯🇵", KR: "🇰🇷", SA: "🇸🇦",
  TR: "🇹🇷", RU: "🇷🇺", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", US: "🇺🇸",
};

function formatChange(c: RankChange): string {
  if (c.oldRank === null || c.change === null) return `${c.windowLabel}  ——`;
  const arrow = c.change > 0 ? "⬆" : c.change < 0 ? "⬇" : "→";
  return `${c.windowLabel}  ${c.oldRank}→${c.oldRank - (c.change ?? 0)}  ${arrow}${Math.abs(c.change)}${c.triggered ? "🔥" : ""}`;
}

export function buildFeishuMessage(anomalies: Anomaly[], date: string): string {
  if (anomalies.length === 0) return "";

  const byCountry = new Map<string, Anomaly[]>();
  for (const a of anomalies) {
    if (!byCountry.has(a.country)) byCountry.set(a.country, []);
    byCountry.get(a.country)!.push(a);
  }
  for (const apps of byCountry.values()) apps.sort((a, b) => a.currentRank - b.currentRank);

  const lines: string[] = [`📊 **游戏下载榜异动警报** | ${date}\n`];

  for (const [country, apps] of byCountry) {
    lines.push(`${FLAGS[country] || "🏳️"} **${apps[0].countryName}**`);

    for (const app of apps) {
      const maxChange = Math.max(...app.changes.map((c) => c.change ?? 0));
      lines.push(`  ${app.emoji} **${app.appName}**  app链接：[🔗](${app.appStoreUrl})`);
      lines.push(`        当前排名：**${app.currentRank}名**  (⬆${maxChange})`);
      lines.push(`        ${app.changes.map(formatChange).join("  |  ")}`);
      lines.push("");
    }
  }

  lines.push(`---\n共 ${anomalies.length} 款游戏触发异动`);
  return lines.join("\n");
}

export async function sendFeishuMessage(message: string): Promise<void> {
  if (!message) { console.log("[reporter] 无消息需要发送"); return; }
  const url = process.env.FEISHU_WEBHOOK_URL;
  if (!url) throw new Error("缺少环境变量 FEISHU_WEBHOOK_URL");

  const body = {
    msg_type: "interactive",
    card: {
      header: { title: { tag: "plain_text", content: "📊 游戏下载榜异动警报" }, template: "blue" as const },
      elements: [{ tag: "markdown", content: message }],
    },
  };

  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = (await res.json()) as { StatusCode?: number };
      if (result.StatusCode !== 0) throw new Error("飞书返回错误");
      console.log("[reporter] 飞书消息发送成功");
      return;
    } catch (err) {
      if (i === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i - 1)));
    }
  }
}
