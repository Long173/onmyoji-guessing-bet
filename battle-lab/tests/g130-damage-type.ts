// tests/g130-damage-type.ts — ★★★ 第 253 轮：**伤害类型按原文记对**（`[tips_5]` = 间接伤害）+ 同比例多语义的合并
//
// 由来（探针 tools/_probe-m253b.ts / _probe-m253d.ts）：
//   · 全库 **25 条**技能写「造成…N%[tips_5]」，其中 **24 条**的比例真的落在伤害槽里 —— 而这 24 条此前**全部**记成 `NORMAL`：
//     通用模式 `dmgGeneric` 只看「造成…N%…（伤害|[tips_N]）」，从不读尾巴上的**语义**（tips 占位符的名字 / 字面类型词）。
//   · 更糟的一半：**同一次伤害被解析两遍**。581_03「五光斩」的 195% 间接伤害被 `dmgGeneric` 与 `dmgIndirect` 各收一次，
//     561_03「泷之决荡」的 150% 真实伤害被 `dmgGeneric` 与 `dmgTrue` 各收一次 —— 去重键是 `type:ratio`，
//     两条不同类型因此都活下来 ⇒ 一次施放把那一击打了**两遍**（多算）。
//   本轮把类型判定收到一处（`typeOfDamageTail`）：两半用同一个答案，重复自然合流。
//
// 判据：产物逐条核对 · 重复槽归零 · 合并记录（延迟那一次）· 反向（真两次的不许合）· **语义真的生效**（dealDamage 的三个开关）· 指纹护栏。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { dealDamage } from "../kernel/damage.ts";
import { DamageType } from "../kernel/types.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const dump: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "skill-ir.json"), "utf8"));
const byId = (id: string) => dump.find((x: any) => x.id === id);
const types = (ir: any) => (ir.damage ?? []).map((d: any) => d.type + ":" + Number(d.ratio));

sec("[1] ★★★ 产物：写「造成…N%[tips_5]」的槽，类型按原文记成 INDIRECT");
{
  const withInd = dump.filter((ir: any) => (ir.damage ?? []).some((d: any) => d.type === "INDIRECT"));
  ok("★★★ 全库含 INDIRECT 槽的技能 = **25 条**（24 条来自 [tips_5] + 歌留多「五光斩」的字面写法）", withInd.length === 25, String(withInd.length));
  const CASES: Array<[string, number]> = [["258_01", 125], ["311_01", 100], ["391_03", 80], ["267_03", 9]];
  for (const [id, ratio] of CASES) {
    const ir: any = byId(id);
    ok("★★★ " + id + "「" + ir.name + "」的 " + ratio + "% 槽记成 INDIRECT", types(ir).includes("INDIRECT:" + ratio), JSON.stringify(types(ir)));
  }
  ok("★★ 报表跟着走：recognized 里那一项以 I 打头（不是 N）",
    (byId("391_03").recognized ?? []).some((r: string) => /^dmg:.*I80/.test(r)), JSON.stringify(byId("391_03").recognized));
  ok("★★ 反向：把 [tips_5] 当**类别词**用的句子不收（296_03 的 88% 不在槽位里 ⇒ 不许凭空多一条）",
    !types(byId("296_03")).some((t: string) => t.startsWith("INDIRECT")), JSON.stringify(types(byId("296_03"))));
  const dist = (() => { const c: Record<string, number> = {}; for (const ir of dump) for (const d of (ir.damage ?? [])) c[d.type] = (c[d.type] ?? 0) + 1; return c; })();
  ok("★★ 反向：类型只多了这两族 —— 全库槽分布 = NORMAL 515 + INDIRECT 26 + TRUE 3 + FIXED 1（没有凭空多出别的类型）",
    dist.NORMAL === 515 && dist.INDIRECT === 26 && dist.TRUE === 3 && dist.FIXED === 1, JSON.stringify(dist));
  /**
   * ★★★ 补量（探针 tools/_probe-m253h.ts）：**类型占位符不止 `[tips_5]`** —— tips 表里名字含「伤害」的有 5 个
   *   （间接 5 / 真实 18 / 固定 28 / 传导 12 / 形毁 5732），按**名字**建表之后 324_02「齿甲」的 12% 也记对了（此前 NORMAL）。
   */
  ok("★★★ 324_02「齿甲」的 12% 记成 TRUE（它写的是 [tips_18] = 真实伤害，不是字面词 —— 只有按占位符名字认才收得到）",
    types(byId("324_02")).includes("TRUE:12"), JSON.stringify(types(byId("324_02"))));
}

sec("[2] ★★★ 同一击被解析两遍的**多算**修掉了（561_03 / 581_03）");
{
  ok("★★★ 561_03「泷之决荡」只剩 **1 条**槽（TRUE:150），此前是 NORMAL:150 + TRUE:150 两条",
    types(byId("561_03")).length === 1 && types(byId("561_03"))[0] === "TRUE:150", JSON.stringify(types(byId("561_03"))));
  ok("★★★ 581_03「五光斩」只剩 **2 条**槽（INDIRECT:290 + INDIRECT:195），此前 3 条（195 被收了两遍 ⇒ 一次施放打 680%）",
    types(byId("581_03")).join(",") === "INDIRECT:290,INDIRECT:195", JSON.stringify(types(byId("581_03"))));
  /**
   * ★★★ 实测（第一版断言写错了）：这一条**不是"全库归零"** —— 全库还剩 **1 条**「同比例 + 两种类型」，
   *   就是 365_01「雀啄」的两次**真的**伤害（攻击50% 普通 + 防御50% 真实）。它由下一节 [4] 的反向断言守着。
   *   这一节要钉的是：**"同一次伤害被解析两遍"那两处（561_03 / 581_03）已经清零**。
   */
  const sameRatioTwoTypes = (() => { const bad: string[] = []; for (const ir of dump) { const seen = new Map<number, string>(); for (const d of (ir.damage ?? [])) { const r = Number(d.ratio); if (seen.has(r) && seen.get(r) !== d.type) bad.push(String(ir.id)); seen.set(r, d.type); } } return bad; })();
  ok("★★★ 全库「同一比例 + 两种类型」只剩 **1 条**（365_01 的两次真伤害）—— 两处重复收已清零",
    sameRatioTwoTypes.length === 1 && sameRatioTwoTypes[0] === "365_01", JSON.stringify(sameRatioTwoTypes));
}

sec("[3] ★★★ 合并记录：**延迟 + 有条件**的那一次不是即时伤害（251_03）");
{
  const ir: any = byId("251_03");
  ok("★★★ 产物只剩即时那一条（NORMAL:100）", types(ir).join(",") === "NORMAL:100", JSON.stringify(types(ir)));
  const c = (ir.damageTypeCollisions ?? [])[0];
  ok("★★★ 被丢掉的那一半原样记着（kept/dropped/ratio/clause 四件套，clause 可复核）",
    !!c && Number(c.ratio) === 100 && c.kept === "NORMAL" && c.dropped === "INDIRECT" && /回合开始前/.test(String(c.clause)), JSON.stringify(c));
  ok("★★ 全库只有这 1 条合并记录（不是批量吞伤害）", dump.filter((x: any) => (x.damageTypeCollisions ?? []).length > 0).length === 1,
    JSON.stringify(dump.filter((x: any) => (x.damageTypeCollisions ?? []).length > 0).map((x: any) => x.id)));
}

sec("[4] ★★★ 反向（fail-closed）：**真的两次**伤害不许被合掉 —— 365_01「雀啄」");
{
  const ir: any = byId("365_01");
  ok("★★★ 365_01 的两条槽都在（攻击50% 普通 + 防御50% 真实），没有被合并",
    types(ir).join(",") === "NORMAL:50,TRUE:50", JSON.stringify(types(ir)));
  ok("★★★ 它**没有**合并记录（判据要求「后出现的那一次」带延迟/条件标记，这里读不出来 ⇒ 两条都留）",
    (ir.damageTypeCollisions ?? []).length === 0, JSON.stringify(ir.damageTypeCollisions ?? []));
}

sec("[5] ★★★ 语义真的生效：dealDamage 的三个开关（不是只改了个标签）");
{
  const m: any = canonicalMatch();
  const a: any = assembleMatch(createKit(bundle), m, { seed: 253, passives: "NOT_EXECUTED", traceLevel: "FULL" });
  await a.battle.runStartup();
  const src = a.battle.teams[0].members[0], dst = a.battle.teams[1].members[0];
  src.base.cri = 0;   // 反向对照要干净：暴击率归零，只有"必暴"那一条才会暴
  const hit = (type: any, def?: number) => { const keep = dst.base.def; if (def !== undefined) dst.base.def = def; const p = dealDamage(a.battle, { source: src, target: dst, base: 1000, rate: 1, type }); if (def !== undefined) dst.base.def = keep; return p; };
  const ind = await hit(DamageType.INDIRECT);
  const nor = await hit(DamageType.NORMAL);
  ok("★★★ 间接伤害**不触发御魂**（triggersSoul=false），普通伤害触发", ind.triggersSoul === false && nor.triggersSoul === true, JSON.stringify({ ind: ind.triggersSoul, nor: nor.triggersSoul }));
  ok("★★★ 间接伤害**无法被分担**（canBeShared=false），普通伤害可以", ind.canBeShared === false && nor.canBeShared === true, JSON.stringify({ ind: ind.canBeShared, nor: nor.canBeShared }));
  const ind0 = await hit(DamageType.INDIRECT, 0);
  ok("★★★ 间接伤害对**防御为 0** 的目标必定暴击（官方[5]）", ind0.isCrit === true, JSON.stringify({ isCrit: ind0.isCrit, def: ind0.defenseMultiplier }));
  const nor0 = await hit(DamageType.NORMAL, 0);
  ok("★★ 反向：普通伤害在同样条件下不白送暴击（cri=0 ⇒ 不暴）", nor0.isCrit === false, String(nor0.isCrit));
  const tru = await hit(DamageType.TRUE);
  ok("★★ 真实伤害无视防御（ignoresDefense=true）—— 561_03 那条槽现在走的是这条语义", tru.ignoresDefense === true, String(tru.ignoresDefense));
  ok("★★ 且两者都能暴击（canCrit 相同：NORMAL 与 INDIRECT）", ind.canCrit === true && nor.canCrit === true);
}

sec("[6] ★★ 指纹护栏：类型改对了，但**两个典型指纹逐位不变**（语义差别在这局没有触发路径）");
{
  /** 与 g113 / g115 同一套参数（seed 20261001、默认档直接 run()）—— 指纹常量才有可比性 */
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.run();
  ok("★★★ 默认档仍逐位不变（2d7c7507e18db61f）", stateHash(captureState(a.battle)) === "2d7c7507e18db61f", stateHash(captureState(a.battle)));
  const c: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  await c.battle.runStartup(); await c.battle.run();
  ok("★★★ 被动档仍逐位不变（7bc24506bdcd349e）", stateHash(captureState(c.battle)) === "7bc24506bdcd349e", stateHash(captureState(c.battle)));
  const LINEUP = [202, 297, 601, 225, 346, 205, 358, 267, 352, 390];
  const owners = dump.filter((ir: any) => (ir.damage ?? []).some((d: any) => d.type === "INDIRECT")).map((ir: any) => Number(ir.charId));
  /**
   * ★★ 实测：这 25 条的主人里有 **3 个**在典型阵容里（225 跳跳弟弟 / 267 樱花妖 / 390 神启荒）——
   *   而上面两条指纹是**现场跑出来的**"逐位不变"。INDIRECT 与 NORMAL 的差别只有三处
   *   （不触发御魂 / 无法被分担 / 对防御为 0 必暴），这三处在两个典型档里都走不到：
   *   分摊至今**未实现**（registry LINK = NONE）· 双方防御都大于 0 · 典型对局里所有单位的御魂都是空的（`soulId: null`）⇒ "不触发御魂"这一处也没有差别。
   *   ★ 如实记边界：这是"这一局不区分"，不是"永远不区分" —— 换阵容/开御魂档就要重新跑指纹。
   */
  ok("★★ 25 条的主人里 3 个在典型阵容（225 / 267 / 390）—— 指纹仍逐位不变 ⇒ 语义差别在这一局走不到",
    [...new Set(owners.filter((c: number) => LINEUP.includes(c)))].sort((x: number, y: number) => x - y).join(",") === "225,267,390",
    JSON.stringify([...new Set(owners.filter((c: number) => LINEUP.includes(c)))]));
}

console.log("\ng130-damage-type: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
