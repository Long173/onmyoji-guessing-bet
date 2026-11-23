// components/mechanics/redZoneGroups.ts — 红区状态分组（★ 第 62 轮从 .vue 里抽出来的纯函数）
//
// 抽出来的原因不是"整洁"，是**原来那段代码没法被测试**，而它藏着两个静默失效：
//
//   ① 分组遍历的是一张**写死的清单** STATUS_ORDER，而红区数据来自 kb/experiments.json：
//      `STATUS_ORDER.map(s => ({ rules: redZones.filter(z => z.status === s) }))`
//      —— 数据里一旦出现清单里没有的状态，**那些规则不会被渲染，也不会报错**。
//      今天不漏，是靠巧合：数据里恰好只有 UNKNOWN / HYPOTHESIS 两种，而清单里正好有三种。
//      （G7 开始产出 VERIFIED 之后还会多一种；再往后只要多任何一种，这一页就开始静默少条目。）
//
//   ② 圆点颜色的写法是嵌套三元 + else 兜底：
//      `g.status === 'UNKNOWN' ? danger : g.status === 'HYPOTHESIS' ? warn : ok`
//      —— 兜底是 **ok（绿）**。也就是说，一个界面不认识的状态会被画成"已验证"的样子。
//      静默丢条目已经够糟；把不认识的状态涂成绿色是**反向误导**。
//
// 所以规则重写成两句话：
//   · **哪些状态存在，由数据决定**；清单只管显示顺序，管不了"存在与否"；
//   · 清单里没有的状态必须**照样成组**，用中性语气（idle）与一句明确的说明。
// 这两条由 tests/ui5-knowledge.ts 直接对这个函数断言（可以喂一个假数据进去）。

export interface RedZoneLike {
  zone: string; id: string; status: string;
  question?: string; evidence?: string; source?: string; rawStatus?: string | null;
}

export type RedZoneTone = "danger" | "warn" | "ok" | "idle";

export interface RedZoneGroup {
  status: string;
  label: string;
  help: string;
  tone: RedZoneTone;
  rules: RedZoneLike[];
}

/** 显示顺序偏好。★ 它**不是**"允许出现的状态"白名单 —— 见文件头。 */
export const STATUS_ORDER = ["UNKNOWN", "HYPOTHESIS", "VERIFIED"];

export const STATUS_LABEL: Record<string, string> = {
  UNKNOWN: "UNKNOWN · unknown (no assumptions allowed)",
  HYPOTHESIS: "HYPOTHESIS · sourced hypothesis (not tested in game)",
  VERIFIED: "VERIFIED · confirmed by in-game testing",
};

export const STATUS_HELP: Record<string, string> = {
  UNKNOWN: "No evidence at all; the engine only uses a placeholder. These mechanics are never guessed, only explicitly flagged.",
  HYPOTHESIS: "Has a source (official tooltip / spec / community implementation) but no in-game confirmation — still a hypothesis.",
  VERIFIED: "Confirmed by in-game observation; can be used as an established mechanic.",
};

/** 语气 → 颜色变量。idle 是中性色：不认识的状态**不许**被涂成 ok。 */
export const TONE_VAR: Record<RedZoneTone, string> = {
  danger: "var(--danger)", warn: "var(--warn)", ok: "var(--ok)", idle: "var(--fg-dim)",
};

const TONE: Record<string, RedZoneTone> = { UNKNOWN: "danger", HYPOTHESIS: "warn", VERIFIED: "ok" };

/**
 * 按状态分组。**先按清单排已知的状态，再把数据里其余的接在后面** ——
 * 顺序是偏好，覆盖是义务：任何一条红区都必须落在某个组里。
 */
export function groupRedZones(zones: RedZoneLike[]): RedZoneGroup[] {
  const present = [...new Set(zones.map(z => z.status))];
  const known = STATUS_ORDER.filter(s => present.includes(s));
  const rest = present.filter(s => !STATUS_ORDER.includes(s)).sort();
  return [...known, ...rest].map(status => ({
    status,
    label: STATUS_LABEL[status] ?? status + " (status not yet supported by the UI)",
    help: STATUS_HELP[status] ?? "The engine reported a status the UI does not list. It was **not dropped**, but the UI has no description for it yet — add it to STATUS_LABEL / STATUS_HELP.",
    tone: TONE[status] ?? "idle",
    rules: zones.filter(z => z.status === status),
  }));
}
