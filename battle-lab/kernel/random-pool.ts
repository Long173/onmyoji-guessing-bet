// kernel/random-pool.ts — ★★★ 第 194 轮：**「随机增益 / 随机减益」是一个有 KB 数据的池子**
//
// 由来（缺口清单里「来源承受者」剩下的两条之一）：
//   匣中少女「溢彩」287_02 写着「受到攻击时，有100%[基础概率]为攻击者附加**1个[随机减益]效果**，持续1回合」。
//   此前的处置是 fail-closed —— 它没有 `[buff_x]` 引用，编译器认不出「该附加什么」，于是整条不落地。
//   ★ 但数据**是有的**，而且就在 `data/kb/tips.json` 里（第 200 / 201 条）：
//       「随机增益」：包含以下5种，提升10%攻击、20%防御、10%暴击伤害、10点速度、10%效果抵抗。
//       「随机减益」：包含以下5种，降低10%攻击、20%防御、10%暴击伤害、10点速度、10%效果抵抗。
//   —— 池子、条目、数值、单位全写明了。所以这不是「猜一个随机减益」，而是**读数据**。
//
// 两件事只有一份判据（都在本文件）：
//   ① parseRandomPool —— 从 tips 的**名字 + desc** 解析出池子；
//   ② poolEntryDef   —— 把一个池子条目变成引擎能施加的状态定义（id 由 kind+prop 决定 ⇒ 确定性）。
import { StatusCategory } from "./types.ts";
import type { StatusDef } from "./status.ts";

/** 池子的一个条目：改哪一维、怎么改、改多少 */
export interface PoolEntry {
  prop: string;
  mode: "ADD_RATE" | "FIXED";
  /** 已带符号（降低 ⇒ 负） */
  value: number;
  /** 原文里的说法（「攻击-10%」），用于状态名与留痕 */
  label: string;
}

export interface RandomPoolSpec {
  kind: "BUFF" | "DEBUFF";
  /** KB 里那个名字（「随机增益」/「随机减益」） */
  name: string;
  entries: PoolEntry[];
  /** 判据所依据的原文（tips 的 desc） */
  evidence: string;
}

/** 中文维度名 → 引擎属性名。★ 只在**读不出来**时落空（不猜）。 */
const PROP_CN: Record<string, string> = {
  "攻击": "atk", "防御": "def", "暴击伤害": "crid", "暴击": "cri",
  "速度": "spd", "效果抵抗": "efr", "效果命中": "efh", "生命": "maxHp",
};

/**
 * 从 tips 的**名字 + desc** 解析池子。**认不出来就是 null**（fail-closed，绝不兜一个默认池子）。
 * 判据（三条都要）：
 *   ① 名字里有「增益」或「减益」（池子的**性质**由名字决定，而不是由我们按条目正负去猜）；
 *   ② desc 里能逐条读出「提升/降低 N点/N% 某属性」；
 *   ③ 至少 2 条 —— 一条的不叫池子，那是一个普通状态。
 */
export function parseRandomPool(name: string, desc: string): RandomPoolSpec | null {
  const n = String(name ?? "");
  const kind: "BUFF" | "DEBUFF" | null = /减益/.test(n) ? "DEBUFF" : /增益/.test(n) ? "BUFF" : null;
  if (!kind) return null;
  const d = String(desc ?? "");
  /**
   * ★★ 中文列表的写法是**第一个条目带动词、后面省略**：
   *   「包含以下5种，降低10%攻击、20%防御、10%暴击伤害、10点速度、10%效果抵抗。」
   *   —— 只有「攻击」前面有「降低」。第一版按「每条都要有动词」写，于是整条 desc **一条都读不出来**
   *   （parseRandomPool 返回 null，池子静默为空）。现在按条目切分并**继承上一个动词**。
   */
  const WITH_VERB = /(提升|降低|增加|减少)\s*(\d+(?:\.\d+)?)\s*(点|%)\s*(攻击|防御|暴击伤害|暴击|速度|效果抵抗|效果命中|生命)/;
  const BARE = /(\d+(?:\.\d+)?)\s*(点|%)\s*(攻击|防御|暴击伤害|暴击|速度|效果抵抗|效果命中|生命)/;
  const entries: PoolEntry[] = [];
  let verb: string | null = null;
  for (const part of d.split(/[、，,；;。]/)) {
    const m = WITH_VERB.exec(part);
    const bare = m ? null : BARE.exec(part);
    if (!m && !bare) continue;
    if (m) verb = m[1];
    if (!verb) continue;                       // 没有动词可继承 ⇒ 不猜这一条
    const num = m ? m[2] : bare![1];
    const unit = m ? m[3] : bare![2];
    const cn = m ? m[4] : bare![3];
    const prop = PROP_CN[cn];
    if (!prop) continue;
    const up = verb === "提升" || verb === "增加";
    const raw = Number(num);
    const value = (up ? raw : -raw) * (unit === "点" ? 1 : 0.01);
    entries.push({ prop, mode: unit === "点" ? "FIXED" : "ADD_RATE", value, label: cn + (up ? "+" : "-") + num + unit });
  }
  if (entries.length < 2) return null;
  return { kind, name: n, entries, evidence: d };
}

/**
 * 把一个池子条目变成**可施加的状态定义**。
 *   ★ id 由 `kind + prop` 决定 ⇒ **确定性**（同一场里抽到同一个条目，状态 id 一定一样；
 *     而 id 会进 stateHash，所以这里不许有任何随机成分）。
 *   ★ 状态**不带** effects —— 效果由调用方按条目现算并随状态一起挂（见 Entity.addStatus 的第 5 个参数）：
 *     这是引擎既有的口径（状态自带的效果到期一并回收）。
 */
/**
 * ★★★ 第 194 轮：**按 id 重建池子状态的壳**（跨进程恢复用）。
 *
 * 池子产生的状态 id 是 `RANDOM_<KIND>_<prop>`（确定性，见 poolEntryDef），而它**不在 KB 里** ——
 * 换进程恢复时 `kit.statusDefOf`（按 KB 现编译）找不到它，状态会被**静默丢掉**
 * （第 190 轮那一类错）。这里按 id 把壳重建出来：
 * 效果与剩余回合都在存档里（kernel/state.ts 的 EntityState.statuses[].effects / remaining），
 * 所以只需要 id / 名字 / 类别 / 行为标记这些**不随时间变的部分**。
 * ★ 认不出来（不是池子 id）⇒ null —— 恢复路径照旧如实记名，不猜。
 */
export function poolDefFromId(id: string): StatusDef | null {
  const m = /^RANDOM_(BUFF|DEBUFF)_([A-Za-z]+)$/.exec(String(id ?? ""));
  if (!m) return null;
  const kind = m[1] as "BUFF" | "DEBUFF";
  return {
    id, name: (kind === "BUFF" ? "随机增益" : "随机减益") + "·" + m[2] + "（按 id 重建）",
    category: (kind === "BUFF" ? StatusCategory.BUFF_STATE : StatusCategory.DEBUFF_STATE) as any,
    dispellable: true, removable: true,
    preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false,
    durationPolicy: "SOURCE_TURN",
    desc: "（由「随机增益/随机减益」池子施加 —— 定义按 id 重建，效果与剩余回合由存档恢复）",
  };
}

export function poolEntryDef(spec: RandomPoolSpec, entry: PoolEntry, duration: number): StatusDef {
  return {
    id: "RANDOM_" + spec.kind + "_" + entry.prop,
    name: spec.name + "·" + entry.label,
    category: (spec.kind === "BUFF" ? StatusCategory.BUFF_STATE : StatusCategory.DEBUFF_STATE) as any,
    dispellable: true, removable: true,
    preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false,
    durationPolicy: "SOURCE_TURN",
    desc: spec.evidence + "（本层为「" + entry.label + "」，持续 " + duration + " 回合）",
  };
}
