/**
 * 推送模块 — 飞书消息组装与发送
 */

import type { Anomaly, RankChange } from "./types.js";
import { groupAndSort } from "./comparator.js";
import { MAX_RETRIES } from "./config.js";

function formatChange(c: RankChange): string {
  if (c.oldRank === null || c.change === null) return `${c.windowLabel}(—)—`;
  const arrow = c.change > 0 ? "↑" : c.change < 0 ? "↓" : "→";
  return `${c.windowLabel}(${c.oldRank})${arrow}${Math.abs(c.change)}${c.triggered ? "🔥" : ""}`;
}

function formatAnomaly(a: Anomaly): string {
  const maxChange = Math.max(...a.changes.map((c) => c.change ?? 0));
  const display = maxChange > 0 ? `↑${maxChange}` : "";
  return [
    `  ${a.emoji} **${a.appName}**  第 ${a.currentRank} 名 ${display}  [🔗](${a.appStoreUrl})`,
    `     ${a.changes.map(formatChange).join("  |  ")}`,
  ].join("\n");
}

export function buildFeishuMessage(anomalies: Anomaly[], date: string): string {
  if (anomalies.length === 0) return "";
  const groups = groupAndSort(anomalies);
  const lines: string[] = [`📊 **App 下载榜异动警报** | ${date}\n`];
  const flags: Record<string, string> = {
    CN: "🇨🇳", TW: "🇹🇼", JP: "🇯🇵", KR: "🇰🇷", SA: "🇸🇦",
    TR: "🇹🇷", RU: "🇷🇺", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", US: "🇺🇸",
  };
  for (const [key, apps] of groups) {
    const [country, category] = key.split("::");
    lines.push(`${flags[country] || "🏳️"} ${country} · ${category}`);
    for (const app of apps) { lines.push(formatAnomaly(app)); lines.push(""); }
  }
  lines.push(`---\n共 ${anomalies.length} 个 App 触发异动 · ${date}`);
  return lines.join("\n");
}

export async function sendFeishuMessage(message: string): Promise<void> {
  if (!message) { console.log("[reporter] 无消息需要发送"); return; }
  const url = process.env.FEISHU_WEBHOOK_URL;
  if (!url) throw new Error("缺少环境变量 FEISHU_WEBHOOK_URL");

  const body = { msg_type: "interactive", card: { header: { title: { tag: "plain_text", content: "📊 App 下载榜异动警报" }, template: "blue" as const }, elements: [{ tag: "markdown", content: message }] } };

  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json() as { StatusCode?: number };
      if (result.StatusCode !== 0) throw new Error("飞书返回错误");
      console.log("[reporter] 飞书消息发送成功");
      return;
    } catch (err) {
      if (i === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i - 1)));
    }
  }
}
