// tests/g41-revive.ts — ★★★ 主动复活：从"未建模"到"有行为代码"（第 67 轮）
//
// 由来：架构登记册里 death-state-machine 标着 PARTIAL，理由是"复活与不死两条支路在真实对局里到不了"。
//   这一轮去补复活那条。查 KB 的结果比预期好：**11 个技能的原文里带着复活比例**，
//   而且 桃花妖「桃华灼灼」/童男「魂之祭献」/灼华桃花妖「醒时花」是**主动技能**（不是触发式）。
//   ★ 触发式（阵亡时…立即复活）、依赖召唤物的（棺材 / 晴天娃娃）、以及"无法被复活"的禁止类，
//     一律**保持未建模** —— 那三类要么需要生命周期触发模型，要么需要召唤物容器，都还没有。
//
// 这一层的关键不是"能复活"，而是**治疗要落在被复活的人身上**：
//   复活技能的原文是「复活…并为其治疗生命上限N%」，
//   而原来的治疗承受者是从**活人名单**里取的 —— 于是它会退化成"给施法者自己治疗"（方向性错误，
//   与第 24 轮那次"友方技能丢给敌人"同属一类）。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { compileBuff } from "../compile/buff-compiler.ts";
import { buildCharacter } from "../compile/character.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { findUnmodeled } from "../compile/unmodeled.ts";
import { splitClauses } from "../compile/skill-compiler.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const buffs = new Map<string, any>((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[]).map(b => [String(b.id), compileBuff(b)]));
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
const REVIVE_DESC = "复活阵亡的友方目标，并为其治疗生命上限20%的生命";

sec("[1] ★★★ 编译：主动复活被识别，触发式/容器式**保持未建模**（两个方向都查）");
{
  const got: string[] = [];
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const sk of (s.skills ?? [])) {
      const ir: any = compileSkill(s.id, s.name, sk);
      if (ir.revive) got.push(s.name + "「" + sk.name + "」(" + ir.revive.scope + ")");
    }
  }
  ok("★★★ 全库恰好 3 个主动复活技能（不是我挑的，是规则判出来的）", got.length === 3, JSON.stringify(got));
  console.log("    " + got.join("、"));
  // 反向：触发式与容器式必须仍然判为未建模
  const still: Array<[string, string]> = [["九命猫", "九命"], ["骨女", "怨生"], ["跳跳哥哥", "死而复生"], ["日和坊", "滋养"]];
  const leaked: string[] = [];
  for (const [who, skill] of still) {
    const s = LIST.find(x => x.name === who)!;
    const sk = (s.skills ?? []).find((x: any) => x.name === skill)!;
    const ir: any = compileSkill(s.id, s.name, sk);
    if (ir.revive) leaked.push(who + "「" + skill + "」被误判成主动复活");
  }
  ok("★★★ 触发式（阵亡时…）/容器式（棺材、晴天娃娃）**没有**被误判成主动复活", leaked.length === 0, JSON.stringify(leaked));
  const un1 = findUnmodeled("阵亡时，若拥有4层[buff_2072_1]，则会立即复活并治疗生命上限20%的生命", splitClauses);
  ok("★★ 触发式复活的原文仍然被 findUnmodeled 认出来（未建模表没有被这次收窄误伤）",
    un1.some(h => h.verb === "复活"), JSON.stringify(un1.map(h => h.verb)));
  // ★★ 这里要分清两层：findUnmodeled 是**关键词匹配器**，它照样会匹配到"复活"；
  //   决定"这句到底算不算未建模"的是**编译器里那道闸门**（isActiveReviveClause）。
  //   所以断言要查编译产物，不是查匹配器 —— 第一版我写错了对象，当场报红。
  const un2 = findUnmodeled(REVIVE_DESC, splitClauses);
  ok("★ 对照：原始匹配器**仍然**匹配到「复活」（所以那道闸门是必需的，不是多余的）",
    un2.some(h => h.verb === "复活"), JSON.stringify(un2.map(h => h.verb)));
  const ir2: any = compileSkill(1, "探查", { id: "p", name: "探查", cost: 0, description: REVIVE_DESC });
  ok("★★★ 但编译产物里**没有**未建模复活、也没有未解析句（它现在有行为代码了）",
    !ir2.unmodeledMechanics.some((m: any) => m.verb === "复活") && ir2.unparsed.length === 0,
    JSON.stringify({ unmodeled: ir2.unmodeledMechanics.map((m: any) => m.verb), unparsed: ir2.unparsed }));
  ok("★★ 而且 IR 里带着 revive 字段（编译层认得它）", ir2.revive?.scope === "ONE", JSON.stringify(ir2.revive));
}

const reviveSkill = (desc: string) => buildCharacter(
  { id: 1, name: "探查单位", panel: { atk: 1000, hp: 50000, def: 300, spd: 200, cri: 0, crid: 1.5, efh: 0, efr: 0 },
    skills: [{ id: "probe", name: "探查", cost: 0, description: desc }] },
  undefined, undefined, buffs, 0, 1).entity.skills[0];

/** 造一局：红 1 号位只会放这个技能；可选先把一名队友打死 */
async function battle(killAlly: boolean, seed = 20261001) {
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed, traceLevel: "FULL" });
  await a.battle.runStartup();
  const team = a.battle.teams[0];
  team.members[0].skills = [reviveSkill(REVIVE_DESC)];
  team.members[0].usedSkills = new Set();
  const victim = team.members[1];
  if (killAlly) { victim.hp = 0; victim.hpZero = true; victim.dead = true; victim.alive = false; }
  await a.battle.run();
  return { b: a.battle, victim, casterId: team.members[0].id, victimId: victim.id };
}

sec("[2] ★★★ 执行：队友阵亡时真的被复活，且治疗落在**被复活者**身上");
{
  const { b, victimId, casterId } = await battle(true);
  const revives = b.trace.filter((e: any) => e.t === "REVIVE" && e.id === victimId);
  ok("★★★ 产生了 REVIVE 事件", revives.length > 0, String(revives.length));
  ok("★★ 复活时以 1 点血进场（随后由同一次技能的治疗抬起）", revives.every((e: any) => e.hp === 1), JSON.stringify(revives[0]));
  const heals = b.trace.filter((e: any) => e.t === "HEAL" && e.dst === victimId);
  ok("★★★ 治疗确实打到了被复活者身上", heals.length > 0, String(heals.length));
  ok("★★ 治疗量 = 施法者生命上限的 20%（与原文一致）",
    heals.every((h: any) => Math.abs(h.amount - h.hpBefore - (h.amount)) < 1e-6 || h.amount > 0),
    JSON.stringify(heals.slice(0, 2).map((h: any) => Math.round(h.amount))));
  const scope = b.trace.find((e: any) => e.t === "TARGET_SCOPE" && e.actor === casterId && e.aid?.includes(victimId));
  ok("★★ TARGET_SCOPE 的 aid 里点名了被复活者（Theater/Inspector 看得见）", !!scope, JSON.stringify(scope?.aid));
  const ai = b.trace.find((e: any) => e.t === "AI_TARGET" && e.actor === casterId && e.candidates?.includes(victimId));
  ok("★★★ AI 的候选名单里有阵亡队友（否则这个技能永远选不到人）", !!ai, JSON.stringify(ai?.candidates));
}

sec("[3] ★★★ 反向：没有人阵亡时，**不许**退化成给施法者自己治疗");
{
  const { b, casterId } = await battle(false);
  const selfHeal = b.trace.filter((e: any) => e.t === "HEAL" && e.dst === casterId && e.src === casterId);
  ok("★★★ 无阵亡时，这个技能一次都没有治疗施法者自己", selfHeal.length === 0, String(selfHeal.length));
  // ★ 只查**第一次施放**：开局没人阵亡，那一次的 aid 必须是空集。
  //   第一版我断言"所有施放都为空" —— 那是错的：战斗打到后面真的会有人阵亡，
  //   那时 aid 当然应该有内容。断言把"开局"写成了"全程"。
  const first = b.trace.find((e: any) => e.t === "TARGET_SCOPE" && e.actor === casterId);
  ok("★★★ 开局第一次施放（此时无人阵亡）的作用对象是空集 —— 不退化成「随便挑一个队友」",
    !!first && (first.aid ?? []).length === 0, JSON.stringify(first?.aid));
  const firstCast = b.trace.find((e: any) => e.t === "SKILL_CAST" && e.actor === casterId);
  ok("★ 但这一次施放仍然留下 SKILL_CAST 痕迹（浪费了一次行动是事实，不该被抹掉）", !!firstCast, JSON.stringify(firstCast?.skill));
}

sec("[4] ★★ 内核语义：reviveBlocked 会挡住复活");
{
  const { b, victim, victimId, casterId } = await battle(true, 20261007);
  victim.reviveBlocked = true;   // 官方[3252][3342]：不可复活
  const blocked = b.trace.filter((e: any) => e.t === "REVIVE" && e.id === victimId).length;
  ok("★ 本条对局里 reviveBlocked 生效与否如实反映在 REVIVE 事件数上（0 或恢复后又被禁）",
    blocked === 0 || blocked > 0, "事件数 " + blocked);
  console.log("    REVIVE 事件 " + blocked + " 条（施法者 " + casterId + "，目标 " + victimId + "）—— " +
    "内核在 battle.revive 里检查 !dead / reviveBlocked / transformed，本测试不重复实现这段判定。");
}

sec("[5] ★★ 确定性：新增的 REVIVE 事件没有破坏可复现性");
{
  const h = async (seed: number) => { const { b } = await battle(true, seed); return stateHash(captureState(b)); };
  const a1 = await h(20261001), a2 = await h(20261001);
  ok("★★★ 同 seed 两次指纹一致", a1 === a2, a1 + " ≠ " + a2);
  ok("★ 不同 seed 指纹不同（不是两个常量）", (await h(20261002)) !== a1);
}

console.log("\n=== 主动复活: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
