// tests/g117-ghost-eye.ts — ★★★ 第 238 轮：**合成计数器状态**（GHOST_EYE）
//
// §169（百目鬼「鬼眸」）的第一块：把「睁开N只鬼眸」做成**真实状态**，
// 这样「当睁开5只鬼眸时」能落进已有的 STACK_AT_LEAST，而存档/State Hash/重放全部免费继承。
// 尺子盯四件事：① id 确定性（会进 stateHash，不许有随机成分）；② 定义的行为标记（不可驱散/不阻止行动）；
// ③ 跨进程恢复的兜底（StatusBook 被清掉也要能按 id 重建壳）；④ 反向：不是这个 id ⇒ null。
import fs from "node:fs";
import path from "node:path";
import { StatusBook, GHOST_EYE_ID, ghostEyeDef, counterDefFromId } from "../kernel/status.ts";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, restoreBattle, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

sec("[1] 定义：确定性 + 行为标记 + 反向");
{
  const a = ghostEyeDef(), b = ghostEyeDef();
  ok("★★★ id 是确定性常量（两次构造逐字节相同 —— 它会进 stateHash）",
    a.id === GHOST_EYE_ID && JSON.stringify(a) === JSON.stringify(b), a.id);
  ok("★★ id 是 GHOST_EYE（改名＝改指纹，属破坏性改动）", GHOST_EYE_ID === "GHOST_EYE", GHOST_EYE_ID);
  ok("★★★ 不可驱散、不可解除（它是计数器，不是可被扒掉的状态）", a.dispellable === false && a.removable === false);
  ok("★★★ 不阻止行动 / 不锁条（百目鬼照样能行动）", a.preventsAction === false && a.locksTimeline === false && a.forcesBasicAttack === false);
  ok("★★ 时长策略 GLOBAL（逐层累积，不由某个来源的回合数决定）", a.durationPolicy === "GLOBAL", a.durationPolicy);
  ok("★★ 按 id 重建（与 poolDefFromId 同职责）", counterDefFromId("GHOST_EYE")?.id === GHOST_EYE_ID);
  ok("★★★ 反向：不是这个 id ⇒ null（绝不兜一个默认壳）", counterDefFromId("2012_1") === null && counterDefFromId("") === null && counterDefFromId("ghost_eye") === null);
}

sec("[2] 跨进程恢复：StatusBook 被清掉也必须活着（合成状态不在 KB 里）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const me = a.battle.teams[0].members[0];
  me.addStatus(ghostEyeDef(), me.id, 3, 99999, [], 5);
  const st = captureState(a.battle);
  ok("★★ 前置：存档里真有这个状态（3 层）", JSON.stringify(st).includes("GHOST_EYE"), String(st).slice(0, 0));
  const kit = createKit(bundle);
  ok("★★★ 前置：知识库不认识它（statusDefOf 返回 null ⇒ 兜底是承重的）", (kit as any).statusDefOf("GHOST_EYE") === null);
  StatusBook.delete("GHOST_EYE");
  ok("★★★ 冷进程模拟：StatusBook 里也删掉之后取不到了", !StatusBook.get("GHOST_EYE"));
  const r: any = restoreBattle(JSON.parse(JSON.stringify(st)), { kit, makeRuntime: (sid: number) => runtimeFor(kit, sid), attachRuntime } as any);
  const owner = r.teams[0].members.find((m: any) => m.statuses.some((s: any) => String(s.def.id) === "GHOST_EYE"));
  ok("★★★ 恢复后状态还在（counterDefFromId 按 id 重建了壳）", !!owner, JSON.stringify(r.teams[0].members.map((m: any) => m.statuses.map((s: any) => s.def.id))));
  const notes = r.teams[0].members.flatMap((m: any) => m.notes ?? []).filter((n: string) => n.includes("missing-statusdef"));
  ok("★★★ 零恢复痕迹", notes.length === 0, JSON.stringify(notes));
  const got: any = owner?.statuses.find((s: any) => String(s.def.id) === "GHOST_EYE");
  ok("★★★ 层数照旧（3 层）—— 计数器不能被恢复过程归零", got?.stacks === 3, JSON.stringify(got?.stacks));
}

sec("[3] 反向：默认档指纹逐位不变（本轮只加了一个定义，没有生产者）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.run();
  ok("★★★ 默认档 2d7c7507e18db61f", stateHash(captureState(a.battle)) === "2d7c7507e18db61f", stateHash(captureState(a.battle)));
  const c: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  await c.battle.runStartup(); await c.battle.run();
  ok("★★★ 被动档 7bc24506bdcd349e", stateHash(captureState(c.battle)) === "7bc24506bdcd349e", stateHash(captureState(c.battle)));
}

console.log("\n=== 鬼眸计数器: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;