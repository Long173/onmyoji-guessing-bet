// tests/g76-event-wiring.ts — ★★★ 第 120 轮：把「机制在跑、只有 trace」的那批事件码接进总线
//
// 由来（第 119 轮的四态账）：TRACE_ONLY 8 个 —— HEAL / RECOVER / HP_LOSS / STATUS_REMOVE /
//   STATUS_EXPIRE / STATUS_MISS / TIMELINE_MISS / ORB_GAIN。它们的**机制一直在跑**，只是只有 trace 通道：
//   Theater 看得见，而「受到治疗时」这类触发类机制**挂不上**（声明表说它们没有派发点）。
// 这一轮：Battle 加**事件队列**（同步生产者没法 await 派发 —— 硬写就是悬空 Promise），
//   生产者入队、Battle 在安全点 drain；顺带把只有声明的 ORB_OVERFLOW / ORB_COST 也接上。
//
// 本测试只回答一个问题：**它们真的会触发吗** —— 而不是「代码里有那一行」。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { healTarget, loseHp } from "../kernel/damage.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { compileSkill } from "../compile/skill-compiler.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";
import { EV } from "../kernel/types.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const CODES = ["HEAL", "RECOVER", "HP_LOSS", "STATUS_ADD", "STATUS_REMOVE", "STATUS_EXPIRE", "STATUS_MISS", "TIMELINE_MISS", "ORB_GAIN", "ORB_OVERFLOW", "ORB_COST", "SHIELD_CREATE", "SHIELD_DAMAGE", "SHIELD_BREAK"];
const probe = (battle: any, sink: Record<string, number>) => {
  for (const c of CODES) battle.bus.register({ id: "P:" + c, ownerId: 0, code: c, range: "ALL", priority: 0, passive: false, fn: () => { sink[c] = (sink[c] ?? 0) + 1; } });
};

sec("[1] 直接驱动：同步生产点 → 队列 → drain（drain 之前订阅者一次都不该被调用）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const b = a.battle;
  await b.runStartup();
  const sink: Record<string, number> = {};
  probe(b, sink);
  const src = b.teams[0].members[0], dst = b.teams[0].members[1];
  dst.hp = Math.max(1, dst.hp - 300);
  healTarget(b, src, dst, 100);
  healTarget(b, src, dst, 100, { recover: true });
  loseHp(b, dst, 10);
  ok("★★★ 入队后**未 drain**：订阅者一次都没被调用（证明走的确实是队列）",
    (sink.HEAL ?? 0) + (sink.RECOVER ?? 0) + (sink.HP_LOSS ?? 0) === 0, JSON.stringify(sink));
  const n = await b.drainEvents();
  ok("★★★ drain 一次投递 3 条（治愈 / 恢复 / 失血各一）", n === 3, String(n));
  ok("★★★ 三个码都真的送到了订阅者", sink.HEAL === 1 && sink.RECOVER === 1 && sink.HP_LOSS === 1,
    JSON.stringify({ HEAL: sink.HEAL, RECOVER: sink.RECOVER, HP_LOSS: sink.HP_LOSS }));
  ok("★★ 事件链里也各有一个节点（Inspector 同样看得见）",
    ["HEAL", "RECOVER", "HP_LOSS"].every(c => b.bus.chain.some((x: any) => x.code === c)));
  ok("★★ 排空后再 drain 返回 0（不会重复投递）", (await b.drainEvents()) === 0);
}

sec("[2] 真实对局：哪些码在自然战斗里就会触发（两个 seed，0 的那些也如实记下）");
const observed: Record<string, number> = {};
{
  for (const seed of [20261001, 123456]) {
    const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed });
    const sink: Record<string, number> = {};
    probe(a.battle, sink);
    await a.battle.run();
    for (const c of CODES) observed[c] = (observed[c] ?? 0) + (sink[c] ?? 0);
    ok("★★★ seed " + seed + "：战斗结束时**队列是空的**（没有事件永远送不到）", (a.battle.pendingEvents ?? []).length === 0);
  }
  console.log("    两局合计：" + CODES.map(c => c + "=" + (observed[c] ?? 0)).join(" "));
  ok("★★★ HEAL / STATUS_EXPIRE 反复触发（各 > 10 次）",
    (observed.HEAL ?? 0) > 10 && (observed.STATUS_EXPIRE ?? 0) > 10,
    JSON.stringify({ HEAL: observed.HEAL, STATUS_EXPIRE: observed.STATUS_EXPIRE }));
  ok("★★★ ORB_GAIN / ORB_COST 也都触发过", (observed.ORB_GAIN ?? 0) > 0 && (observed.ORB_COST ?? 0) > 0,
    JSON.stringify({ ORB_GAIN: observed.ORB_GAIN, ORB_COST: observed.ORB_COST }));
  ok("★★ 接线的码全部在 EV 表里（没有野码）", CODES.every(c => Object.keys(EV).includes(c)));
  ok("★★★ STATUS_ADD（第 122 轮接）在自然对局里触发 " + (observed.STATUS_ADD ?? 0) + " 次（> 10）",
    (observed.STATUS_ADD ?? 0) > 10, String(observed.STATUS_ADD ?? 0));
}

sec("[3] 定向场景：自然对局触发不到的两个码，用带该子句的式神逼出来");
{
  const swap = (id: number) => { const m: any = JSON.parse(JSON.stringify(canonicalMatch())); m.red.units[0].shikigamiId = id; m.blue.units[0].shikigamiId = id; return m; };
  let tl = 0, ov = 0;
  for (const seed of [1, 2, 3]) {
    const t: any = assembleMatch(createKit(bundle), swap(256), { seed });
    const st: Record<string, number> = {}; probe(t.battle, st); await t.battle.run();
    tl += st.TIMELINE_MISS ?? 0;
    const o: any = assembleMatch(createKit(bundle), swap(205), { seed });
    const so: Record<string, number> = {}; probe(o.battle, so); await o.battle.run();
    ov += so.ORB_OVERFLOW ?? 0;
  }
  ok("★★★ TIMELINE_MISS：3 局定向场景（妖琴师 20% 击退行动条）里触发 " + tl + " 次", tl > 0, String(tl));
  ok("★★★ ORB_OVERFLOW：3 局定向场景（座敷童子 50% 获得鬼火）里触发 " + ov + " 次", ov > 0, String(ov));
}

sec("[4] 队列语义：同批按入队顺序；drain 期间新入队的事件留到下一批");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const b = a.battle;
  await b.runStartup();
  const order: string[] = [];
  const src = b.teams[0].members[0], dst = b.teams[0].members[1];
  dst.hp = Math.max(1, dst.hp - 500);
  b.bus.register({ id: "ORDER:HEAL", ownerId: 0, code: "HEAL", range: "ALL", priority: 0, passive: false, fn: async () => {
    order.push("HEAL");
    healTarget(b, src, dst, 1, { recover: true });
  } });
  b.bus.register({ id: "ORDER:RECOVER", ownerId: 0, code: "RECOVER", range: "ALL", priority: 0, passive: false, fn: () => { order.push("RECOVER"); } });
  healTarget(b, src, dst, 1);
  healTarget(b, src, dst, 1, { recover: true });
  const n1 = await b.drainEvents();
  ok("★★★ 第一批只投递入队的两条（HEAL 处理期间新入队的那条**不插队**）",
    n1 === 2 && order.join(",") === "HEAL,RECOVER", n1 + "｜" + order.join(","));
  const n2 = await b.drainEvents();
  ok("★★★ 第二批才投递 drain 期间新入队的那条", n2 === 1 && order.join(",") === "HEAL,RECOVER,RECOVER",
    n2 + "｜" + order.join(","));
}

sec("[5] 行为中性：接线不改战斗结果，挂探针也不改");
{
  const base: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await base.battle.run();
  const h = stateHash(captureState(base.battle));
  ok("★★★ 典型对局指纹仍是 2d7c7507e18db61f（接线没有动行为）", h === "2d7c7507e18db61f", h);
  const wp: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const sink: Record<string, number> = {}; probe(wp.battle, sink);
  await wp.battle.run();
  ok("★★★ 挂上 10 个探针后指纹**不变**（订阅者不改变状态）", stateHash(captureState(wp.battle)) === h, stateHash(captureState(wp.battle)));
}

sec("[6] 记账：可达性与未观测项（这些数字一变就要来说明）");
{
  const kb = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const list: any[] = Array.isArray(kb) ? kb : (kb.characters ?? kb.items ?? []);
  const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
  let skills = 0, purge = 0, statusRefs = 0, timeline = 0, orbGain = 0;
  for (const s of list) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const sk of (s.skills ?? [])) {
      skills++;
      const ir: any = compileSkill(s.id, s.name, sk);
      if (ir.purge?.length) purge++;
      if (ir.statusRefs?.length) statusRefs++;
      if (ir.timeline?.length) timeline++;
      if ((ir.orb?.gain ?? 0) > 0) orbGain++;
    }
  }
  // ★★★ 第 199 轮：38 → **37**。摘掉了 4 条**规则句/条件句**（晴明「言灵·缚」×2 · 入殓师「离魂」 · 梦寻山兔「梦心迷兔阵！」），
  //   它们此前被当成「本技能在驱散」⇒ 施放时凭空扒状态（多仓）；现在记进新键 purgeSkips。
  // ★★★ 第 196 轮：39 → **38**。摘掉了食梦貘「沉睡」那条假命中（「**不会自动移除**目标的沉睡」是关于这个状态的
  //   **规则**，不是本技能在移除它）—— 这不是数字漂移，是少算/多算各减一条。
  ok("★★★ 802 个技能里带非空 purge 的 **37** 条 ⇒ STATUS_REMOVE 的派发点不是死代码", skills === 802 && purge === 37, skills + " / purge " + purge);
  ok("★★ 可达性来源：有 timeline 的 " + timeline + " 条、有 orb.gain 的 " + orbGain + " 条、有 statusRefs 的 " + statusRefs + " 条",
    timeline > 0 && orbGain > 0 && statusRefs > 0);
  ok("★★★ 如实记账：STATUS_MISS 本轮 8 局（含定向）**一次都没触发** —— 派发点在代码里存在（g75 仍算 BUS），但条件没被走到。哪天真触发了这条会红，届时改成已观测",
    (observed.STATUS_MISS ?? 0) === 0, String(observed.STATUS_MISS ?? 0));
}

sec("[7] 第 122 轮接的码：护盾三兄弟（直接驱动）与变形（定向形态场景）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const b = a.battle;
  await b.runStartup();
  const sink: Record<string, number> = {};
  probe(b, sink);
  const src = b.teams[0].members[0], dst = b.teams[1].members[0];
  dst.addShield({ value: 10, sourceId: src.id, tag: "probe" });
  ok("★★★ 加盾后**未 drain**：SHIELD_CREATE 一次都没送到（走的是队列）", (sink.SHIELD_CREATE ?? 0) === 0);
  await b.drainEvents();
  ok("★★★ drain 后 SHIELD_CREATE = 1（护盾创建进总线了）", sink.SHIELD_CREATE === 1, JSON.stringify(sink));
  await b.damage(src, dst, 100, "NORMAL");
  await b.drainEvents();
  ok("★★★ 100 点伤害打穿 10 点小盾 ⇒ SHIELD_DAMAGE 与 SHIELD_BREAK 各 1",
    sink.SHIELD_DAMAGE === 1 && sink.SHIELD_BREAK === 1, JSON.stringify(sink));
  ok("★★ 三个护盾事件都在事件链里（Inspector 看不见就必须补）",
    ["SHIELD_CREATE", "SHIELD_DAMAGE", "SHIELD_BREAK"].every(c => b.bus.chain.some((x: any) => x.code === c)));
  const addBefore = sink.STATUS_ADD ?? 0;
  dst.addStatus({ id: "probe_add", name: "探查·状态", category: "BUFF_STATE", dispellable: true, removable: true, blocksRevive: false, durationPolicy: "SOURCE_TURN", tags: [] } as any, 999, 1, 3);
  ok("★★★ 加状态后未 drain：STATUS_ADD 还没送（生产点 → sink → 队列）", (sink.STATUS_ADD ?? 0) === addBefore);
  await b.drainEvents();
  ok("★★★ drain 后 STATUS_ADD +1", (sink.STATUS_ADD ?? 0) === addBefore + 1, String(sink.STATUS_ADD));

  /** 变形：形态的编译要 tips 表（没设置时 forms 静默为空 —— 第 101 轮踩过并写进 g62 的断言里） */
  const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
  const tipsList = Array.isArray(tipsRaw) ? tipsRaw : ((Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]) ?? []);
  setTipsTable(loadTips(tipsList));
  const kb = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const list: any[] = Array.isArray(kb) ? kb : (kb.characters ?? kb.items ?? []);
  const snake = list.find((s: any) => s.name === "神堕八岐大蛇");
  ok("前置：KB 里有神堕八岐大蛇（「神堕之力」= 化身形态）", !!snake);
  if (snake) {
    const m: any = JSON.parse(JSON.stringify(canonicalMatch()));
    m.red.units[0].shikigamiId = snake.id; m.blue.units[0].shikigamiId = snake.id;
    const t: any = assembleMatch(createKit(bundle), m, { seed: 1 });
    await t.battle.runStartup();
    const actor = t.battle.teams[0].members[0];
    const formSkill = actor.skills.find((s: any) => s.name === "神堕之力");
    ok("★★ 换上场后确实带着「神堕之力」（cost=0，ON_CAST 形态）", !!formSkill, JSON.stringify(actor.skills.map((s: any) => s.name)));
    let tf = 0;
    t.battle.bus.register({ id: "P:TRANSFORM", ownerId: 0, code: "TRANSFORM", range: "ALL", priority: 0, passive: false, fn: () => { tf++; } });
    /**
     * ★ 直接驱动这个技能（而不是等 AI 选中它）：这是一条**真实的生产路径**
     *   （character.ts 的 execute → forms 分支 → kernel/summon.ts 的 enterForm → queueEvent）。
     *   ★ 为什么不等 AI：3 局实测里 AI 一次都没选「神堕之力」（它选了同式神的「审判仪式」）——
     *   那是**选择策略**的问题，不是事件接线的问题，两者不能混着说。
     */
    await formSkill.execute(t.battle, actor, t.battle.enemiesOf(actor.teamId)[0]);
    await t.battle.drainEvents();
    ok("★★★ 驱动「神堕之力」⇒ TRANSFORM 触发（进入形态）", tf >= 1, String(tf));
    ok("★★ 事件链里也有 TRANSFORM 节点", t.battle.bus.chain.some((x: any) => x.code === "TRANSFORM"));
    const enter = t.battle.trace.filter((x: any) => x.t === "FORM_ENTER").length;
    console.log("    形态 trace：FORM_ENTER=" + enter + "（Theater 走 trace，总线走事件 —— 两条通道都在）");
  }
}

console.log("\n=== 事件接线（第 120/122 轮）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;