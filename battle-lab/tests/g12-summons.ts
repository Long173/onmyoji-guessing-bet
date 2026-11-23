// tests/g12-summons.ts — 召唤物与"无身份单位"的状态覆盖（a1-4 §32 Summon System，目标 ⑨）
// 目的：把"已知边界第 7 条"从散文变成**可执行断言**。
//   - 召唤物的**数据**（血量/存活/行动条位置）必须能存能取
//   - 召唤物的**运行时**（技能表）能重建就重建；重建不了必须**明确报出来**，不许静默变空
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { Entity } from "../kernel/entity.ts";
import { captureState, restoreBattle, stateHash } from "../kernel/state.ts";
import { parseSummonSpec } from "../kernel/summon.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const deps = (kit: any) => ({ kit, makeRuntime: (id: number) => runtimeFor(kit, id), attachRuntime });

sec("[1] 召唤物数据必须进状态、能取回");
{
  const kit = createKit(bundle);
  const a = assembleMatch(kit, canonicalMatch(), { seed: 20261001 });
  const b: any = a.battle;
  await b.runStartup();
  // 造两个召唤物：一个有知识库身份（应能重建运行时），一个没有（应报缺口）
  const withId = new Entity(901, "召唤物A", 0, { atk: 1000, hp: 5000, def: 200, spd: 120, cri: 0.1, crid: 1.5, efh: 0, efr: 0 }, 202);
  const noId = new Entity(902, "召唤物B", 0, { atk: 800, hp: 4000, def: 150, spd: 110, cri: 0.05, crid: 1.5, efh: 0, efr: 0 });
  withId.hp = 3210;
  noId.hp = 1234;
  b.teams[0].summons.push(withId, noId);
  b.timeline.add(withId.id, () => withId.speed, 1234);

  const st = captureState(b);
  ok("★ 召唤物被计入状态（数量与身份）", st.teams[0].summons.length === 2 && st.teams[0].summons[0].shikigamiId === 202 && st.teams[0].summons[1].shikigamiId === null, JSON.stringify(st.teams[0].summons.map((s: any) => [s.id, s.shikigamiId])));
  ok("★ 血量被如实记录", st.teams[0].summons[0].hp === 3210 && st.teams[0].summons[1].hp === 1234);
  ok("JSON 往返无损", stateHash(JSON.parse(JSON.stringify(st))) === stateHash(st));

  sec("[2] 恢复：能重建的必须重建，不能重建的必须报出来");
  const kit2 = createKit(bundle);
  const r: any = restoreBattle(JSON.parse(JSON.stringify(st)), deps(kit2) as any);
  const rA = r.teams[0].summons.find((e: any) => e.id === 901);
  const rB = r.teams[0].summons.find((e: any) => e.id === 902);
  ok("召唤物在恢复后回到队伍里", !!rA && !!rB);
  ok("血量逐位一致", rA.hp === 3210 && rB.hp === 1234, `${rA.hp} / ${rB.hp}`);
  ok("★ 有知识库身份的召唤物：技能表被重建", rA.skills.length === 3, String(rA.skills.length));
  ok("★ 无身份的召唤物：**明确报出运行时缺口**，而不是静默给个空技能表", r.restoreGaps.some((g: any) => g.id === 902 && /no shikigamiId/.test(g.note)), JSON.stringify(r.restoreGaps));
  ok("有身份的召唤物不在缺口清单里", !r.restoreGaps.some((g: any) => g.id === 901), JSON.stringify(r.restoreGaps.map((g: any) => g.id)));
  ok("缺口同时写进了该单位的 notes（回放里也看得见）", rB.notes.some((n: string) => n.startsWith("restore:NO_RUNTIME")));

  sec("[3] 行动条位置与守恒");
  ok("★ 召唤物的行动条位置被恢复", r.timeline.get(901)?.pos === 1234, String(r.timeline.get(901)?.pos));
  ok("总体单位数守恒（成员 + 召唤物）", r.allEntities().length === b.allEntities().length, `${r.allEntities().length} vs ${b.allEntities().length}`);
  ok("召唤物计入存活判定（aliveAll）", r.teams[0].aliveAll().some((e: any) => e.id === 901));
}

sec("[4] ★★★ 诚实声明 —— 第 86 轮把它从**散文**变成**断言**");
console.log("    ⚠ 当前引擎**没有任何技能会召唤单位**，所以这里用构造的召唤物做覆盖测试。");
{
  // ★★★ 第 86 轮：这一段此前只有 console.log（散文），没有任何断言。
  //   查清之后发现，真正的原因**不是"还没接线"，而是"没有数据"**：
  //     · KB 里 282 条**全是式神**，没有一条是召唤物；
  //     · 文案里点名召唤的那些单位（番茄 / 诅咒草人 / 棺材 / 白色小鬼 / 鬼面 / 雷云 / 飓风）
  //       **一条都不在 KB 里** —— 没有面板、没有技能、没有 grade；
  //     · 它们的技能（愤怒 / 牺牲 / 自爆）同样不存在。
  //   ⇒ 要"实现召唤"，就得**编**出这些单位的属性与技能 —— 那正是本项目拒绝做的事。
  //     所以这是一条**数据边界**，与 G6/G7 的"需要游戏内观测"同类，而不是待办。
  //
  //   ★ 而"边界"必须能被机械检查，否则它只是一句话。下面三条就是那个检查 ——
  //     尤其第 3 条：**一旦召唤物的数据真的进来了，这条测试会变红**，
  //     提醒"现在该去建运行时了"。边界只在数据缺席时成立。
  const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const all = (Array.isArray(KB) ? KB : []).map((s: any) => String(s.name ?? ""));
  const NAMED = ["番茄", "诅咒草人", "草人", "棺材", "白色小鬼", "鬼面", "雷云", "飓风"];
  const present = NAMED.filter(n => all.includes(n));
  ok("★★★ 文案里点名的召唤单位，KB 里**一个都没有**（精确匹配，不是子串）", present.length === 0, JSON.stringify(present));
  ok("★★ 反向：KB 里确实有名字含「小鬼」的**式神**（盗墓小鬼）—— 说明上面用的是精确匹配，不是子串漏判",
    all.some(n => n.includes("小鬼")) && !all.includes("白色小鬼"));

  // 从全部技能文案里抽出「召唤X」的候选名，逐个查 KB
  let callMentions = 0;
  const withData: string[] = [];
  for (const s of (Array.isArray(KB) ? KB : [])) {
    for (const k of (s.skills ?? [])) {
      const d = String(k.description ?? "");
      for (const mm of d.matchAll(/召唤([^，。；、\s]{2,8})/g)) {
        callMentions++;
        const cand = mm[1].replace(/[0-9]+个?$/, "").replace(/^1个/, "");
        if (all.includes(cand)) withData.push(s.name + "「" + k.name + "」→ " + cand);
      }
    }
  }
  ok("★★★ 抽取到的「召唤X」候选里，**没有一个**能在 KB 里找到同名单位",
    withData.length === 0, JSON.stringify(withData.slice(0, 5)));
  ok("★★★ 而且候选不是空的（抽不到就说明这条断言没在守东西）", callMentions > 0, String(callMentions));
  console.log("    文案里「召唤X」出现 " + callMentions + " 处；其中能在 KB 里找到同名单位的：" + withData.length);

  // 运行时行为：引擎不会**凭空**造召唤物
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.runStartup();
  await a.battle.run();
  const summoned = a.battle.teams.reduce((n: number, tm: any) => n + (tm.summons ?? []).length, 0);
  ok("★★★ 典型对局跑完，双方召唤物容器仍然是**空的**（引擎没有编出单位来）", summoned === 0, String(summoned));
  console.log("    ★ 第 3 条一旦变红，说明召唤物数据进来了 —— 那时该去建 Summon Runtime，而不是继续声明边界。");
}

/**
 * ★★★ 第 98 轮：上面 §4 的边界声明**只对了一半**，这里把它修正到可执行的精度。
 *
 * 保留原文（不改），因为"错在哪"本身是证据：§4 查的是 `shikigami.full.json`，
 * 结论「文案里点名的番茄/诅咒草人/棺材…一个都不在 KB 里」**至今仍然成立**（断言还在上面跑）。
 * 错的是**推论**："所以召唤物没有数据" —— 放置单位的定义**不在式神表里，而在 tips.json 里**：
 * 技能原文用 `[tips_N]` 引用，tips 条目自己写着名字、生命基准、免疫项、复活方式、胜利判定。
 * 实测 6 条（g59 里逐条断言），例如：
 *   · tips_3896 雷冢 —— 须佐之男「神之领域」
 *   · tips_6071 余烬 —— 百羽凤凰火「未熄羽」
 * ⇒ 所以"数据边界"这个判断是**用错了表**得出的；真正的边界只剩「召唤物的**技能**表」（它们用什么技能打人）。
 */
sec("[5] ★★★ 修正：放置单位的数据在 tips.json 里（§4 查错了表）");
{
  const tips = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
  const arr: any[] = Array.isArray(tips) ? tips : Object.values(tips).find((v: any) => Array.isArray(v)) as any[];
  const specs = arr.map((t: any) => parseSummonSpec(t)).filter(Boolean) as any[];
  ok("★★★ tips.json 能解析出放置单位规格（不是 0 条）", specs.length > 0, String(specs.length));
  ok("★★★ 雷冢 / 余烬 两条都在里面", ["3896", "6071"].every(id => specs.some(s => s.tipsId === id)),
    JSON.stringify(specs.map(s => s.tipsId)));
  ok("★★ 规格带证据锚点（evidence 非空且含原文片段）", specs.every(s => s.evidence.length >= 10));
  ok("★★★ 运行时**存在**（§4 说「该去建 Summon Runtime」—— 它现在建好了）",
    typeof (Entity.prototype as any).addSummon !== "function" && typeof (assembleMatch(createKit(bundle), canonicalMatch(), { seed: 1 }).battle as any).addSummon === "function");
  const a2: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a2.battle.runStartup();
  await a2.battle.run();
  const summoned2 = a2.battle.teams.reduce((n: number, tm: any) => n + (tm.summons ?? []).length, 0);
  ok("★ 而典型对局**仍然**是 0 个召唤物 —— 因为那 10 个式神里没有谁带召唤技能（运行时在，是阵容没用到）",
    summoned2 === 0, String(summoned2));
}

console.log(`\n=== 召唤物状态覆盖: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;