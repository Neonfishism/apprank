/**
 * 推送模块 — 飞书消息组装与发送
 */

import type { Anomaly } from "./types.js";
import { MAX_RETRIES, ROBLOX_MARKET, STEAM_MARKET, HIDDEN_WINDOWS } from "./config.js";
import { createHmac } from "crypto";

const FLAGS: Record<string, string> = {
  CN: "🇨🇳", TW: "🇹🇼", JP: "🇯🇵", KR: "🇰🇷", SA: "🇸🇦",
  TR: "🇹🇷", RU: "🇷🇺", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", US: "🇺🇸",
  BR: "🇧🇷", HK: "🇭🇰", ID: "🇮🇩", TH: "🇹🇭", PH: "🇵🇭",
  RB: "🎮",
  ST: "🖥️",
};


const PLATFORM_LABELS: Record<string, string> = {
  ios: "📱 iOS 游戏榜",
  roblox: "🎮 Roblox 在线榜",
  steam: "🖥️ Steam 在线榜",
};

export function buildFeishuMessage(anomalies: Anomaly[], date: string): string {
  if (anomalies.length === 0) return "";

  const lines: string[] = [`📊 **游戏异动警报** | ${date}\n`];

  // 按平台分组
  const iosAnomalies = anomalies.filter((a) => a.country !== ROBLOX_MARKET && a.country !== STEAM_MARKET);
  const rbAnomalies = anomalies.filter((a) => a.country === ROBLOX_MARKET);
  const stAnomalies = anomalies.filter((a) => a.country === STEAM_MARKET);

  let hasContent = false;

  // iOS：按国家
  if (iosAnomalies.length > 0) {
    if (hasContent) lines.push("---");
    hasContent = true;
    lines.push(PLATFORM_LABELS.ios);
    appendRegionBlocks(lines, iosAnomalies);
  }

  // Roblox：单列表
  if (rbAnomalies.length > 0) {
    if (hasContent) lines.push("---");
    hasContent = true;
    lines.push(PLATFORM_LABELS.roblox);
    rbAnomalies.sort((a, b) => a.currentRank - b.currentRank);
    for (const app of rbAnomalies) appendApp(lines, app);
  }

  // Steam：单列表
  if (stAnomalies.length > 0) {
    if (hasContent) lines.push("---");
    hasContent = true;
    lines.push(PLATFORM_LABELS.steam);
    stAnomalies.sort((a, b) => a.currentRank - b.currentRank);
    for (const app of stAnomalies) appendApp(lines, app);
  }

  lines.push(`---\n共 ${anomalies.length} 款游戏触发异动`);
  return lines.join("\n");
}

/** 按国家分组并生成区块文本行 */
function groupByCountry(anomalies: Anomaly[]): Map<string, Anomaly[]> {
  const map = new Map<string, Anomaly[]>();
  for (const a of anomalies) {
    if (!map.has(a.country)) map.set(a.country, []);
    map.get(a.country)!.push(a);
  }
  return map;
}

function appendRegionBlocks(lines: string[], anomalies: Anomaly[]) {
  const byCountry = groupByCountry(anomalies);
  let firstCountry = true;
  for (const [country, apps] of byCountry) {
    if (!firstCountry) lines.push("---");
    firstCountry = false;
    apps.sort((a, b) => a.currentRank - b.currentRank);
    lines.push(`  ${FLAGS[country] || "🏳️"} **${apps[0].countryName}**`);
    for (const app of apps) appendApp(lines, app);
  }
}

/** 将一个国家区块渲染为纯文本（不含前后分隔线） */
function renderRegionBlock(country: string, apps: Anomaly[]): string {
  const sorted = [...apps].sort((a, b) => a.currentRank - b.currentRank);
  const lines: string[] = [];
  lines.push(`  ${FLAGS[country] || "🏳️"} **${sorted[0].countryName}**`);
  for (const app of sorted) appendApp(lines, app);
  return lines.join("\n");
}

/** 飞书 webhook 消息内容上限 */
export const MAX_MSG_LENGTH = 18000;

/**
 * 将 iOS 异动按地区边界拆分成多条消息，避免飞书截断。
 * 返回完整的 markdown 消息数组。
 */
export function buildIosMessageChunks(anomalies: Anomaly[], date: string, maxLen = MAX_MSG_LENGTH): string[] {
  const byCountry = groupByCountry(anomalies);
  if (byCountry.size === 0) return [];

  const header = `📊 **游戏异动警报** | ${date}\n\n📱 iOS 游戏榜\n`;
  const headerLen = header.length;
  const footer = (count: number) => `---\n共 ${count} 款游戏触发异动`;

  const chunks: string[] = [];
  let current = header;
  let count = 0;
  let firstInChunk = true;

  for (const [country, apps] of byCountry) {
    let block = `${firstInChunk ? "" : "\n---\n"}${renderRegionBlock(country, apps)}`;
    if (current.length + block.length + footer(count + apps.length).length + 2 > maxLen && count > 0) {
      // 当前消息已满，结账
      chunks.push(current + footer(count));
      current = header;
      count = 0;
      firstInChunk = true;
      block = renderRegionBlock(country, apps); // 新消息第一个地区，不加 ---
    }
    current += block;
    count += apps.length;
    firstInChunk = false;
  }

  if (count > 0) {
    chunks.push(current + footer(count));
  }

  return chunks;
}

function appendApp(lines: string[], app: Anomaly) {
  const visibleChanges = app.changes.filter((c) => !HIDDEN_WINDOWS.has(c.days));
  if (visibleChanges.length === 0) return;
  const maxChange = Math.max(...visibleChanges.map((c) => c.change ?? 0));
  const triggered = visibleChanges
    .filter((c) => c.triggered)
    .map((c) => {
      const from = c.oldRank !== null ? `${c.oldRank}→` : "新上榜→";
      return `${c.windowLabel} ${from}${app.currentRank}🔥`;
    })
    .join("  |  ");
  lines.push(`    ${app.emoji} **${app.appName}** [🔗](${app.appStoreUrl})  #${app.currentRank}  ⬆${maxChange}  ${triggered}`);
}

export async function sendFeishuMessage(message: string, title = "📊 游戏异动警报"): Promise<void> {
  if (!message) { console.log("[reporter] 无消息需要发送"); return; }
  const urls = (process.env.FEISHU_WEBHOOK_URL || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length === 0) throw new Error("缺少环境变量 FEISHU_WEBHOOK_URL");

  // 支持多个密钥，按逗号分隔，与 URL 一一对应
  const secrets = (process.env.FEISHU_SECRET || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // 截断过长消息
  let content = message;
  if (content.length > MAX_MSG_LENGTH) {
    content = content.slice(0, MAX_MSG_LENGTH);
    const lastNewline = content.lastIndexOf("\n");
    if (lastNewline > 0) content = content.slice(0, lastNewline);
    content += `\n\n⚠️ 消息过长已截断，完整数据见快照文件`;
    console.log(`[reporter] 消息过长 (${message.length}→${content.length})，已截断`);
  }

  const baseBody: Record<string, unknown> = {
    msg_type: "interactive",
    card: {
      header: { title: { tag: "plain_text", content: title }, template: "blue" as const },
      elements: [{ tag: "markdown", content }],
    },
  };

  for (let idx = 0; idx < urls.length; idx++) {
    const url = urls[idx];
    const secret = secrets[idx] || "";
    const signedBody = signBody(baseBody, secret);
    let ok = false;
    for (let i = 1; i <= MAX_RETRIES; i++) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signedBody) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = (await res.json()) as { StatusCode?: number; code?: number; msg?: string };
        if (result.StatusCode !== 0 && result.code !== 0) {
          throw new Error(`飞书返回错误: ${result.msg || JSON.stringify(result)}`);
        }
        ok = true;
        break;
      } catch (err) {
        if (i === MAX_RETRIES) {
          console.error(`[reporter] 飞书发送失败 (${url.slice(-20)}): ${(err as Error).message}`);
        } else {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i - 1)));
        }
      }
    }
    if (ok) console.log(`[reporter] 飞书消息发送成功 → ${url.slice(-20)}`);
  }
}

function signBody(body: Record<string, unknown>, secret: string): Record<string, unknown> {
  if (!secret) return body;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = `${timestamp}\n${secret}`;
  return { timestamp, sign: createHmac("sha256", stringToSign).update("").digest("base64"), ...body };
}
