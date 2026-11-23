// tests/g87-two-path-parity.ts — ★★★ 第 133 轮：**两条装配路径必须装同一套订阅**
//
// 由来：三次同类事故都长一个样 ——
//   · 第 93 轮：被动运行时只装在网页路径上，Node 侧（CLI / 基线）里那个开关**只是一句声明**；
//   · 第 132 轮：御魂与被动只装在**装配**路径上，**恢复**路径不装；
//   · 第 133 轮：Node 侧参考装配**既没有御魂、也没有替友方拦死**（接线在后，补装在前）。
// 而既有那条"Node vs Web 逐局一致"的对照（apps/web/tests/ui2-engine.ts §[3]）**测不出来**：
//   典型夹具里没有御魂、被动默认又是关的 —— 两个本该校验差别的数字完全相同。
// ⇒ 本文件用**会差别的夹具**（伊邪那美 + 四件套无刀取 + 打开被动）来比订阅集合与终局结果，
//   并且带一条**反向哨兵**：故意让一条路径少给知识库，比对必须红（否则这个比对是平凡的）。
import fs from "node:fs";
import path from "node:path";
import { compileBuff, toStatusDef } from "../compile/buff-compiler.ts";
import { StatusBook } from "../kernel/status.ts";
import { PassivePolicies } from "../kernel/policies.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { assembleGuessingMatch } from "../soul/guessing-match.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const ID_IZANAMI = LIST.find((x: any) => x.name === "伊邪那美")!.id;
const SOUL_WUDAOQU = 56;
const PASSIVES = "PARSED_CANDIDATES_ONLY" as const;
const DESTRUCT = (() => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[];
  const def = toStatusDef(compileBuff(raw.find(b => String(b.id) === "5572_1")));
  if (!StatusBook.has(def.id)) StatusBook.set(def.id, def);
  return def;
})();
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "guessing-match-canonical-001.json"), "utf8"));

/**
 * 夹具的三处改动（**刻意让三种订阅都出现**）：
 *   · 红 0 保持三尾狐 —— 它的「诱惑」是被动运行时唯一装得上的那一条（换掉它就没有被动了）；
 *   · 红 1 穿四件套无刀取 —— 御魂（TURN_END 的层数 ramp）；
 *   · 红 2 换成伊邪那美 —— 「神赐之吻」的替友方拦死。
 */
function nodeFixture() {
  const f: any = JSON.parse(JSON.stringify(FIXTURE));
  f.red[1] = { ...f.red[1], soulIds: [SOUL_WUDAOQU, SOUL_WUDAOQU, SOUL_WUDAOQU, SOUL_WUDAOQU] };
  f.red[2] = { ...f.red[2], name: "伊邪那美", shikigamiId: ID_IZANAMI };
  return f;
}
/** 网页侧对局：同样的三处改动（同一个 KB id / 同一个御魂） */
function webMatch() {
  const m: any = canonicalMatch();
  m.red.units[1] = { ...m.red.units[1], soulId: SOUL_WUDAOQU };
  m.red.units[2] = { ...m.red.units[2], shikigamiId: ID_IZANAMI, name: "伊邪那美" };
  return m;
}
/** 订阅集合（只看三种订阅：御魂 / 被动 / 替友方拦死） */
const ids = (battle: any) => (battle.bus.handlers ?? [])
  .filter((h: any) => h.source === "SOUL" || h.source === "PASSIVE" || String(h.id).startsWith("allyGuard:"))
  .map((h: any) => h.id).sort();
const stackCount = (battle: any, idx: number) =>
  (battle.teams[0].members[idx].effects ?? []).filter((x: any) => typeof x.source === "string" && x.source.startsWith("soul" + SOUL_WUDAOQU + ":stack")).length;

sec("[1] ★★★ 两条路径装同一套订阅（会差别的夹具：伊邪那美 + 四件套无刀取 + 打开被动）");
const kit = createKit(bundle);
const webA: any = assembleMatch(kit, webMatch(), { seed: 20261303, passives: PASSIVES, traceLevel: "FULL" });
const nodeA: any = await assembleGuessingMatch(nodeFixture(), { seed: 20261303, maxTurns: 300, policies: { passives: PassivePolicies.PARSED_CANDIDATES_ONLY } });
const webIds = ids(webA.battle), nodeIds = ids(nodeA.battle);
ok("★ 前置：这个夹具下订阅集合**非空**（否则下面的比对是平凡的）", webIds.length >= 3, JSON.stringify(webIds));
ok("★★★ 三种订阅都在场（御魂 + 被动 + 替友方拦死）",
  webIds.some((x: string) => x.includes("SOUL")) && webIds.some((x: string) => x.startsWith("passive:")) && webIds.some((x: string) => x.startsWith("allyGuard:")),
  JSON.stringify(webIds));
ok("★★★ Node 侧参考装配的订阅集合与网页路径**逐项相同**",
  JSON.stringify(webIds) === JSON.stringify(nodeIds),
  JSON.stringify({ web: webIds, node: nodeIds }));
ok("★★ 两边的被动安装报告一致（装了哪几句也一样）",
  JSON.stringify((webA.battle.passiveReport?.installed ?? []).map((x: any) => x.skill + "/" + x.family).sort()) ===
  JSON.stringify((nodeA.battle.passiveReport?.installed ?? []).map((x: any) => x.skill + "/" + x.family).sort()),
  JSON.stringify({ web: (webA.battle.passiveReport?.installed ?? []).length, node: (nodeA.battle.passiveReport?.installed ?? []).length }));

sec("[2] ★★★ 10 个 seed 逐局一致（胜者 / 结束原因 / 回合数）");
{
  const seeds = [20261001, 20261002, 7, 11111, 424242, 99999, 31415926, 555001, 100000, 20261303];
  const diffs: string[] = [];
  for (const seed of seeds) {
    const n: any = await assembleGuessingMatch(nodeFixture(), { seed, maxTurns: 300, policies: { passives: PassivePolicies.PARSED_CANDIDATES_ONLY } });
    const nr = await n.battle.run();
    const w: any = assembleMatch(createKit(bundle), webMatch(), { seed, passives: PASSIVES, traceLevel: "FULL" });
    const wr = await w.battle.run();
    const a = nr.winner + "/" + nr.reason + "/" + nr.turns;
    const b = wr.winner + "/" + wr.reason + "/" + wr.turns;
    if (a !== b) diffs.push("seed " + seed + ": Node=" + a + " Web=" + b);
  }
  ok("★★★ 10 个 seed 全部逐局一致", diffs.length === 0, diffs.join(" | "));
}

sec("[3] ★★★ 不是「两边都没有」：Node 路径上御魂与拦死**真的在跑**");
{
  const n: any = await assembleGuessingMatch(nodeFixture(), { seed: 20261303, maxTurns: 300, policies: { passives: PassivePolicies.PARSED_CANDIDATES_ONLY } });
  await n.battle.runStartup();
  const b = n.battle, owner = b.teams[0].members[2], mate = b.teams[0].members[1], foe = b.teams[1].members[0];
  ok("★★★ Node 路径装上了御魂（soulReport 点名无刀取）",
    !!b.soulReport && b.soulReport.installed.some((x: any) => x.soulId === SOUL_WUDAOQU),
    JSON.stringify(b.soulReport?.installed?.map((x: any) => x.soulId)));
  ok("★★★ Node 路径装上了替友方拦死（allyGuardReport 非空）",
    (b.allyGuardReport ?? []).length === 1, JSON.stringify(b.allyGuardReport));
  mate.addStatus(DESTRUCT, owner.id, 1, 5);
  mate.hp = 0; mate.hpZero = true;
  await b.resolveLethal(mate, foe.id);
  ok("★★★ 拦死真的生效：队友留下 1 点生命（第 133 轮之前这条路径上它直接死）",
    mate.dead === false && mate.hp === 1, JSON.stringify({ dead: mate.dead, hp: mate.hp }));
  // 御魂：跑到回合结束即可叠一层（无刀取 = TURN_END）
  const before = stackCount(b, 1);
  await b.runPartial(b.turn + 25);   // 无刀取挂在 TURN_END 上 ⇒ 要等那个单位真的行动过（实测第 8 回合叠到第 1 层）
  ok("★★ 御魂的层数 ramp 在 Node 路径上也开始叠了", stackCount(b, 1) > before, JSON.stringify({ before, after: stackCount(b, 1) }));
}

sec("[4] ★★ 反向哨兵：故意让一条路径少给知识库 ⇒ 比对必须红（证明这个比对照得出差别）");
{
  const m: any = webMatch();
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261303, passives: PASSIVES, traceLevel: "FULL" });
  const b2: any = assembleMatch(createKit(bundle), m, { seed: 20261303, passives: PASSIVES, traceLevel: "FULL" });
  b2.battle.bus.unregisterOwner; // 占位：不改动，下面用「手工清掉御魂处理器」来模拟少装一套
  b2.battle.bus.handlers = b2.battle.bus.handlers.filter((h: any) => h.source !== "SOUL");
  ok("★★★ 少装一套御魂时订阅集合**确实不同**（所以第 [1] 节的比对不是平凡通过）",
    JSON.stringify(ids(a.battle)) !== JSON.stringify(ids(b2.battle)),
    JSON.stringify({ 全: ids(a.battle), 少御魂: ids(b2.battle) }));
}

sec("[5] ★★ 默认档（被动 OFF、无御魂）两条路径都注册 0 个订阅 —— 默认路径逐位不变");
{
  const plain: any = JSON.parse(JSON.stringify(FIXTURE));
  const n: any = await assembleGuessingMatch(plain, { seed: 20261001, maxTurns: 300 });
  const w: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  ok("★★★ Node 侧：默认夹具 + 默认策略 ⇒ 0 个订阅", ids(n.battle).length === 0, JSON.stringify(ids(n.battle)));
  ok("★★★ 网页侧：同上 ⇒ 0 个订阅", ids(w.battle).length === 0, JSON.stringify(ids(w.battle)));
}

console.log("\ng87-two-path-parity: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);