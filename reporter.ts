/**
 * 推送模块 — 飞书消息组装与发送
 */

import type { Anomaly } from "./types.js";
import { MAX_RETRIES, ROBLOX_MARKET, STEAM_MARKET, WISHLIST_MARKET, HIDDEN_WINDOWS } from "./config.js";
import { createHmac } from "crypto";

const PLATFORM_LABELS: Record<string, string> = {
  ios: "📱 iOS 游戏榜",
  roblox: "🎮 Roblox 在线榜",
  steam: "🖥️ Steam 在线榜",
};

export const MAX_MSG_LENGTH = 18000;

// ── 工具函数：游戏行构建 ──

/** 构建单款游戏的异动行文本（不含缩进） */
function buildAppLine(app: Anomaly): string {
  const visibleChanges = app.changes.filter((c) => !HIDDEN_WINDOWS.has(c.days));
  if (visibleChanges.length === 0) return "";
  let maxChange = 0;
  let maxOldRank: number | null = null;
  for (const c of visibleChanges) {
    if ((c.change ?? 0) > maxChange) { maxChange = c.change!; maxOldRank = c.oldRank; }
  }
  const triggered = visibleChanges
    .filter((c) => c.triggered)
    .map((c) => {
      const from = c.oldRank !== null ? `${c.oldRank}→` : "新上榜→";
      return `${c.windowLabel} ${from}${app.currentRank}🔥`;
    })
    .join("  |  ");

  // 红字规则：增长前名次 ≤60 且升幅 >50，或 >60 且升幅 >80
  const oldRank = maxOldRank ?? app.currentRank;
  const isRed = (oldRank <= 60 && maxChange > 50) || (oldRank > 60 && maxChange > 80);
  const icon = isRed ? "🚀" : "⬆";
  const line = `${icon} **${app.appName}** [🔗](${app.appStoreUrl})  #${app.currentRank}  ⬆${maxChange}  ${triggered}`;
  return isRed ? `<font color='red'>${line}</font>` : line;
}

function appendApp(lines: string[], app: Anomaly) {
  const line = buildAppLine(app);
  if (line) lines.push(`    ${line}`);
}

/** 按国家分组 */
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
    lines.push(`  <font color='blue'>**${apps[0].countryName}**</font>`);
    for (const app of apps) appendApp(lines, app);
  }
}

function renderRegionBlock(country: string, apps: Anomaly[]): string {
  const sorted = [...apps].sort((a, b) => a.currentRank - b.currentRank);
  const lines: string[] = [];
  lines.push(`  <font color='blue'>**${sorted[0].countryName}**</font>`);
  for (const app of sorted) appendApp(lines, app);
  return lines.join("\n");
}

// ── 消息构建 (旧格式，Steam 仍用) ──

export function buildFeishuMessage(anomalies: Anomaly[], date: string): string {
  if (anomalies.length === 0) return "";

  const lines: string[] = [`📊 **游戏异动警报** | ${date}\n`];

  const iosAnomalies = anomalies.filter((a) => a.country !== ROBLOX_MARKET && a.country !== STEAM_MARKET);
  const rbAnomalies = anomalies.filter((a) => a.country === ROBLOX_MARKET);
  const stAnomalies = anomalies.filter((a) => a.country === STEAM_MARKET);

  let hasContent = false;

  if (iosAnomalies.length > 0) {
    if (hasContent) lines.push("---");
    hasContent = true;
    lines.push(PLATFORM_LABELS.ios);
    appendRegionBlocks(lines, iosAnomalies);
  }

  if (rbAnomalies.length > 0) {
    if (hasContent) lines.push("---");
    hasContent = true;
    lines.push(PLATFORM_LABELS.roblox);
    rbAnomalies.sort((a, b) => a.currentRank - b.currentRank);
    for (const app of rbAnomalies) appendApp(lines, app);
  }

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

export function buildIosMessageChunks(anomalies: Anomaly[], date: string, maxLen = MAX_MSG_LENGTH): string[] {
  const byCountry = groupByCountry(anomalies);
  if (byCountry.size === 0) return [];

  const header = `📊 **游戏异动警报** | ${date}\n\n📱 iOS 游戏榜\n`;
  const footer = (count: number) => `---\n共 ${count} 款游戏触发异动`;

  const chunks: string[] = [];
  let current = header;
  let count = 0;
  let firstInChunk = true;

  for (const [country, apps] of byCountry) {
    let block = `${firstInChunk ? "" : "\n---\n"}${renderRegionBlock(country, apps)}`;
    if (current.length + block.length + footer(count + apps.length).length + 2 > maxLen && count > 0) {
      chunks.push(current + footer(count));
      current = header;
      count = 0;
      firstInChunk = true;
      block = renderRegionBlock(country, apps);
    }
    current += block;
    count += apps.length;
    firstInChunk = false;
  }

  if (count > 0) chunks.push(current + footer(count));
  return chunks;
}

// ── 折叠卡片构建 (新格式，iOS 用) ──

/** 飞书卡片 30KB 限制，留 2KB 安全边距 */
const MAX_CARD_BYTES = 28000;

/** 估算一个 countryPanels 数组构建成卡片后的 JSON 大小 */
function estimateCardSize(countryPanels: unknown[], totalGames: number, countryCount: number, date: string): number {
  const card = buildOneCard(countryPanels, totalGames, countryCount, date);
  return JSON.stringify(card).length;
}

/** 构建一张 iOS 折叠卡片 */
function buildOneCard(
  countryPanels: unknown[],
  totalGames: number,
  countryCount: number,
  date: string,
): { title: string; elements: unknown[] } {
  return {
    title: `📱 iOS 游戏异动警报 | ${date}`,
    elements: [
      {
        tag: "collapsible_panel",
        expanded: false,
        header: {
          title: { tag: "plain_text", content: `📱 iOS 游戏榜 — ${countryCount} 个地区，共 ${totalGames} 款游戏` },
          icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
          icon_position: "right" as const,
          icon_expanded_angle: -180,
        },
        border: { color: "grey", corner_radius: "5px" },
        elements: countryPanels,
      },
    ],
  };
}

/**
 * 构建 iOS 折叠卡片消息（单条或多条，自动按 30KB 限制拆分）。
 * 顶层一个折叠面板，内部每个国家一个次级折叠面板。
 */
export function buildIosCollapsibleCards(
  anomalies: Anomaly[],
  date: string
): Array<{ title: string; elements: unknown[] }> {
  const byCountry = groupByCountry(anomalies);
  if (byCountry.size === 0) return [];

  const sortedCountries = [...byCountry.entries()]
    .sort((a, b) => b[1].length - a[1].length);

  const totalGames = anomalies.length;

  // 先构建所有国家面板及其游戏数
  const countryEntries: Array<{ panel: unknown; gameCount: number }> = [];
  for (const [country, apps] of sortedCountries) {
    const sorted = [...apps].sort((a, b) => a.currentRank - b.currentRank);
    const countryName = sorted[0].countryName;

    let hasRocket = false;
    let top3dGame = "";
    let top3dChange = 0;
    for (const app of sorted) {
      const visible = app.changes.filter((c) => !HIDDEN_WINDOWS.has(c.days));
      for (const c of visible) {
        const ch = c.change ?? 0;
        const oldRank = c.oldRank ?? app.currentRank;
        if ((oldRank <= 60 && ch > 50) || (oldRank > 60 && ch > 80)) hasRocket = true;
      }
      const d3 = app.changes.find((c) => c.days === 3 && !HIDDEN_WINDOWS.has(c.days));
      if (d3 && (d3.change ?? 0) > top3dChange) {
        top3dChange = d3.change!;
        top3dGame = app.appName;
      }
    }

    const rocketIcon = hasRocket ? "🚀" : "⬆";
    const titleExtra = top3dGame ? ` ${top3dGame} ⬆${top3dChange}` : "";
    const title = `<font color='blue'>${rocketIcon} **${countryName}**</font> (${sorted.length}款)${titleExtra}`;

    const contentLines: string[] = [];
    for (const app of sorted) {
      const line = buildAppLine(app);
      if (line) contentLines.push(`    ${line}`);
    }

    countryEntries.push({
      gameCount: sorted.length,
      panel: {
        tag: "collapsible_panel",
        expanded: false,
        header: {
          title: { tag: "markdown", content: title },
          icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
          icon_position: "right" as const,
          icon_expanded_angle: -180,
        },
        border: { color: "grey", corner_radius: "5px" },
        elements: [{ tag: "markdown", content: contentLines.join("\n") }],
      },
    });
  }

  const allCountryPanels = countryEntries.map((e) => e.panel);

  // 先尝试单卡片
  const singleCardCountryPanels = [
    {
      tag: "markdown" as const,
      content: `📊 **游戏异动警报** | ${date}\n\n📱 iOS 游戏榜 — ${sortedCountries.length} 个地区，共 ${totalGames} 款游戏`,
    },
    ...allCountryPanels,
  ];

  if (estimateCardSize(singleCardCountryPanels, totalGames, sortedCountries.length, date) <= MAX_CARD_BYTES) {
    return [buildOneCard(singleCardCountryPanels, totalGames, sortedCountries.length, date)];
  }

  // 超过限制，按国家拆分
  console.log(`[reporter] iOS 卡片超过 ${MAX_CARD_BYTES} 字节，开始拆分...`);
  const cards: Array<{ title: string; elements: unknown[] }> = [];
  let chunk: unknown[] = [];
  let chunkGames = 0;
  let chunkCountries = 0;

  function flushChunk(): void {
    if (chunk.length === 0) return;
    const cardCountryPanels = [
      {
        tag: "markdown" as const,
        content: `📊 **游戏异动警报** | ${date}\n\n📱 iOS 游戏榜 — ${chunkCountries} 个地区，共 ${chunkGames} 款游戏`,
      },
      ...chunk,
    ];
    cards.push(buildOneCard(cardCountryPanels, chunkGames, chunkCountries, date));
    chunk = [];
    chunkGames = 0;
    chunkCountries = 0;
  }

  for (const { panel, gameCount } of countryEntries) {
    const testChunk = [
      {
        tag: "markdown" as const,
        content: `📊 **游戏异动警报** | ${date}\n\n📱 iOS 游戏榜 — 共 ${totalGames} 款游戏`,
      },
      ...chunk,
      panel,
    ];

    if (chunk.length > 0 &&
        estimateCardSize(testChunk, totalGames, chunkCountries + 1, date) > MAX_CARD_BYTES) {
      flushChunk();
    }
    chunk.push(panel);
    chunkGames += gameCount;
    chunkCountries++;
  }
  flushChunk();

  // 多卡片时添加编号后缀
  if (cards.length > 1) {
    for (let i = 0; i < cards.length; i++) {
      cards[i].title += ` (${i + 1}/${cards.length})`;
      // 更新折叠面板标题
      const cp = cards[i].elements[0] as Record<string, unknown>;
      if (cp?.header && typeof cp.header === "object") {
        const hdr = cp.header as Record<string, unknown>;
        if (hdr.title && typeof hdr.title === "object") {
          (hdr.title as Record<string, string>).content += ` (${i + 1}/${cards.length})`;
        }
      }
    }
  }

  return cards;
}

/**
 * 构建 Steam 合并卡片消息（在线榜 + 愿望单榜两个折叠面板）。
 */
export function buildSteamCard(
  onlineAnomalies: Anomaly[],
  wishlistAnomalies: Anomaly[],
  date: string
): { title: string; elements: unknown[] } | null {
  const panels: unknown[] = [];

  // 在线榜
  if (onlineAnomalies.length > 0) {
    const sorted = [...onlineAnomalies].sort((a, b) => a.currentRank - b.currentRank);
    const lines: string[] = [`📊 **游戏异动警报** | ${date}\n\n🖥️ Steam 在线榜\n`];
    for (const app of sorted) {
      const line = buildAppLine(app);
      if (line) lines.push(`    ${line}`);
    }
    lines.push(`---\n共 ${onlineAnomalies.length} 款游戏触发异动`);
    panels.push({
      tag: "collapsible_panel",
      expanded: true,
      header: {
        title: { tag: "plain_text", content: `🖥️ Steam 在线榜 — ${onlineAnomalies.length} 款` },
        icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
        icon_position: "right" as const,
        icon_expanded_angle: -180,
      },
      border: { color: "grey", corner_radius: "5px" },
      elements: [{ tag: "markdown", content: lines.join("\n") }],
    });
  }

  // 愿望单榜
  if (wishlistAnomalies.length > 0) {
    const sorted = [...wishlistAnomalies].sort((a, b) => a.currentRank - b.currentRank);
    const lines: string[] = [`📝 Steam 愿望单\n`];
    for (const app of sorted) {
      const line = buildAppLine(app);
      if (line) lines.push(`    ${line}`);
    }
    lines.push(`---\n共 ${wishlistAnomalies.length} 款游戏触发异动`);
    panels.push({
      tag: "collapsible_panel",
      expanded: true,
      header: {
        title: { tag: "plain_text", content: `📝 Steam 愿望单 — ${wishlistAnomalies.length} 款` },
        icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
        icon_position: "right" as const,
        icon_expanded_angle: -180,
      },
      border: { color: "grey", corner_radius: "5px" },
      elements: [{ tag: "markdown", content: lines.join("\n") }],
    });
  }

  if (panels.length === 0) return null;

  return {
    title: `🖥️ Steam 异动警报 | ${date}`,
    elements: panels,
  };
}

// ── 飞书发送 ──

/** 底层发送：签名 + 多 webhook 重试 */
async function _sendCardBody(body: Record<string, unknown>): Promise<void> {
  const urls = (process.env.FEISHU_WEBHOOK_URL || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length === 0) throw new Error("缺少环境变量 FEISHU_WEBHOOK_URL");

  const secrets = (process.env.FEISHU_SECRET || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (let idx = 0; idx < urls.length; idx++) {
    const url = urls[idx];
    const secret = secrets[idx] || "";
    const signedBody = signBody(body, secret);
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

export async function sendFeishuMessage(message: string, title = "📊 游戏异动警报"): Promise<void> {
  if (!message) { console.log("[reporter] 无消息需要发送"); return; }

  let content = message;
  if (content.length > MAX_MSG_LENGTH) {
    content = content.slice(0, MAX_MSG_LENGTH);
    const lastNewline = content.lastIndexOf("\n");
    if (lastNewline > 0) content = content.slice(0, lastNewline);
    content += `\n\n⚠️ 消息过长已截断，完整数据见快照文件`;
    console.log(`[reporter] 消息过长 (${message.length}→${content.length})，已截断`);
  }

  await _sendCardBody({
    msg_type: "interactive",
    card: {
      header: { title: { tag: "plain_text", content: title }, template: "blue" as const },
      elements: [{ tag: "markdown", content }],
    },
  });
}

export async function sendCard(title: string, elements: unknown[]): Promise<void> {
  await _sendCardBody({
    msg_type: "interactive",
    card: {
      header: { title: { tag: "plain_text", content: title }, template: "blue" as const },
      elements,
    },
  });
}

function signBody(body: Record<string, unknown>, secret: string): Record<string, unknown> {
  if (!secret) return body;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = `${timestamp}\n${secret}`;
  return { timestamp, sign: createHmac("sha256", stringToSign).update("").digest("base64"), ...body };
}
