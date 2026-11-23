// tests/g21-purge.ts — ★ 驱散 / 解除：一个**完全没有被实现**的机制，而且被报成 HIGH 置信度
//
// 由来：把 EV 事件码纳入字段级普查后发现 STATUS_REMOVE 从未被派发。追下去：
//   · Entity.dispel() / Entity.remove() 在生产代码里**零调用**（只有 tests/m0 直接调）
//   · 技能文本里的「驱散」「解除」根本没进过 IR
// 最坏的部分不是"没实现"，而是**它自称实现了**：句子只要匹配到 [tips_1] 之类的引用就记为 PARSED，
// 于是「为友方目标驱散3个减益状态或[tips_3]，并治疗生命上限30%的生命」被报成
// confidence=HIGH / unparsed=0 —— Fidelity 的 SKILL 层据此把它算作"完整编译"。
//
// 官方[8]驱散 / 官方[1]解除的差别是现成的：能否驱散看印记的 dispellable，
// 能否解除看 removable。这两个标记一直在，只是从来没人读。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { buildCharacter } from "../compile/character.ts";
import { compileBuff } from "../compile/buff-compiler.ts";
import { StatusBook } from "../kernel/status.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const buffs = new Map<string, any>(
  (JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[])
    .map(b => [String(b.id), compileBuff(b)]),
);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const mk = (desc: string) => compileSkill(1, "探查单位", { id: "probe", name: "探查", cost: 0, description: desc });
const probeSkill = (desc: string) =>
  buildCharacter({ id: 1, name: "探查单位", panel: { atk: 1000, hp: 50000, def: 300, spd: 100, cri: 0, crid: 1.5, efh: 0, efr: 0 }, skills: [{ id: "probe", name: "探查", cost: 0, description: desc }] },
    undefined, undefined, buffs, 0, 1).entity.skills[0];
const fresh = async (seed = 20261001) => {
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed });
  await a.battle.runStartup();
  return a.battle;
};
const firstDebuff = String((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[])
  .find(b => String(compileBuff(b).category).startsWith("DEBUFF") && compileBuff(b).dispellable)!.id);

sec("[1] 解析：数量 / 对象 / 类型");
{
  const p1 = mk("为友方目标驱散3个减益状态");
  ok("前置：解析出了 purge 条目", p1.purge.length === 1, JSON.stringify(p1.purge));
  ok("★ 数量 3", p1.purge[0]?.count === 3, JSON.stringify(p1.purge[0]));
  ok("★ 对象 = 己方（友方目标）", p1.purge[0]?.side === "ALLY", JSON.stringify(p1.purge[0]));
  ok("★ 类型 = 减益", p1.purge[0]?.what === "DEBUFF", JSON.stringify(p1.purge[0]));
  ok("默认动作是 DISPEL（驱散）", p1.purge[0]?.kind === "DISPEL", JSON.stringify(p1.purge[0]));

  const p2 = mk("解除自身所有减益状态");
  ok("★ 「所有」→ count = 99", p2.purge[0]?.count === 99, JSON.stringify(p2.purge));
  ok("★ 动作是 REMOVE（解除）", p2.purge[0]?.kind === "REMOVE", JSON.stringify(p2.purge));

  const p3 = mk("驱散敌方目标1个增益状态");
  ok("★ 对象 = 敌方", p3.purge[0]?.side === "ENEMY" && p3.purge[0]?.what === "BUFF", JSON.stringify(p3.purge));

  const p4 = mk("该护盾不可驱散，且无法被解除");
  ok("★ 「不可驱散 / 无法被解除」是免疫声明，不是动作 → 不产生 purge", p4.purge.length === 0, JSON.stringify(p4.purge));

  const p5 = mk("造成攻击100%的伤害");
  ok("没有驱散字样的技能不产生 purge", p5.purge.length === 0);
}

sec("[2] 运行时：驱散真的把状态拿掉了");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const foe = bt.enemiesOf(0)[0];
  // 真实的进攻性驱散：驱散**敌方**身上的**增益**。内置 StatusBook 里全是减益，
  // 所以这里按 g13 的做法临时造一个可驱散的增益状态（这也让"类型过滤"被真正检验到）。
  const buffDef = { ...StatusBook.get("freeze")!, id: "probe_buff", name: "探查·增益", category: "BUFF_STATE" as any, dispellable: true };
  foe.addStatus(buffDef as any, 999, 1, 5);
  ok("前置：敌人身上有增益", foe.hasStatus("probe_buff"), JSON.stringify(foe.statuses.map((s: any) => s.def.id)));
  const skill = probeSkill("驱散敌方目标1个增益状态");
  bt.trace.length = 0;
  await skill.execute(bt, self, foe);
  const ev = bt.trace.filter((e: any) => e.t === "STATUS_REMOVE");
  ok("★★ 增益被驱散（此前 dispel() 在生产代码里零调用 = 什么都不发生）", !foe.hasStatus("probe_buff"), JSON.stringify(foe.statuses.map((s: any) => s.def.id)));
  ok("★ 发出 STATUS_REMOVE 事件（这个事件码此前从未被派发过）", ev.length === 1 && ev[0].by === "DISPEL", JSON.stringify(ev));
  ok("事件写明顺序依据（驱散优先级是红区，不假装知道）", /红区/.test(ev[0]?.order ?? ""), JSON.stringify(ev[0]));
}

sec("[3] 不可驱散 / 不可解除 的边界必须守住");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const foe = bt.enemiesOf(0)[0];
  foe.addStatus(StatusBook.get("stun")!, 999, 1, 5);            // 眩晕：不可驱散，但可解除
  const dispelSkill = probeSkill("驱散敌方目标1个减益状态");
  await dispelSkill.execute(bt, self, foe);
  ok("★ 不可驱散的状态驱散不掉", foe.hasStatus("stun"), JSON.stringify(foe.statuses.map((s: any) => s.def.id)));
  const removeSkill = probeSkill("解除敌方目标1个减益状态");
  await removeSkill.execute(bt, self, foe);
  ok("★ 但可以解除（remove 看 removable，与 dispel 是两套标记）", !foe.hasStatus("stun"), JSON.stringify(foe.statuses.map((s: any) => s.def.id)));
  const frost = StatusBook.get("frost")!;
  foe.addStatus(frost, 999, 1, 5);
  await removeSkill.execute(bt, self, foe);
  ok("★ 霜冻不可解除（官方[3]明确写死）", foe.hasStatus("frost"), JSON.stringify(foe.statuses.map((s: any) => s.def.id)));
}

sec("[4] 数量上限：写 1 个就只拿 1 个");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const foe = bt.enemiesOf(0)[0];
  const id = firstDebuff;
  const cb = buffs.get(id)!;
  const def = StatusBook.get(cb.id) ?? { id: cb.id, name: cb.name, category: cb.category, dispellable: cb.dispellable, removable: cb.removable, preventsAction: false, preventsSkill: false, forcesBasicAttack: false, suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "SOURCE_TURN", desc: cb.desc };
  StatusBook.set(cb.id, def as any);
  foe.addStatus(def as any, 999, 1, 5);
  foe.addStatus(StatusBook.get("bind")!, 999, 1, 5);            // 禁锢：可驱散
  const before = foe.statuses.filter((s: any) => s.def.dispellable).length;
  ok("前置：身上有 ≥2 个可驱散状态", before >= 2, String(before));
  const skill = probeSkill("驱散敌方目标1个减益状态");
  await skill.execute(bt, self, foe);
  const after = foe.statuses.filter((s: any) => s.def.dispellable).length;
  ok("★ 只掉了 1 个（count=1）", after === before - 1, before + " → " + after);
}

sec("[5] 全库口径：有多少技能真的带上了 purge，以及 HIGH 置信度里的水分");
{
  const shiki = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const list = Array.isArray(shiki) ? shiki : (shiki.characters ?? shiki.items ?? []);
  let withPurge = 0, dispelTxt = 0, highButUnparsed = 0, total = 0;
  for (const c of list) for (const sk of (c.skills ?? [])) {
    total++;
    const ir = compileSkill(Number(c.id ?? 0), String(c.name ?? ""), sk);
    if (ir.purge.length) withPurge++;
    const d = String(sk.description ?? "");
    if (/驱散/.test(d) && !/不可驱散|无法(?:被)?驱散/.test(d)) {
      dispelTxt++;
      // ★ 文本里有驱散、却既没解析出 purge、也没报 unparsed 的 —— 就是"自称完整编译"的水分
      /**
       * ★★★ 第 199 轮：**purgeSkips 也算账**。规则句/条件句（「被束缚的单位可以通过…解除控制」）
       *   不再被当成动作（那会凭空扒状态），但它们**没有消失** —— 逐条记在 purgeSkips 里带理由码。
       *   闸门的本意是「别自称完整」，不是「必须解析成动作」⇒ 有 purgeSkips 就不算水分。
       */
      const recorded = !!(ir as any).purgeSkips?.length;
      if (!ir.purge.length && ir.unparsed.length === 0 && !recorded) { highButUnparsed++; }
    }
  }
  console.log("    技能 " + total + "｜带 purge " + withPurge + "｜文本含「驱散」 " + dispelTxt + "｜其中**既没解析也没报缺口** " + highButUnparsed);
  ok("★ 确实解析出了一批 purge（不是 0）", withPurge > 10, String(withPurge));
  ok("★★ 含驱散却自称无缺口的技能必须为 0（本轮修掉的就是这个）", highButUnparsed === 0, String(highButUnparsed));
}

console.log("\n=== 驱散与解除: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
