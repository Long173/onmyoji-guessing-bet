// tests/ui15-presenter-synth.ts — ★★★ 第 137 轮：用**合成录像**把 Presenter 的规则钉死
//
// 由来（第 137 轮审核）：⑥ G4 的 7 项里有 6 项是「实现有、断言无」—— 护盾、变形、鬼火溢出、
// Banner 的目标/鬼火/段数、Action Bar 的速度变化、Buff Hover。根因是唯一那段真实录像
// （replay-demo-123456.json）里**根本没出现过**这些形态（探针实测：带盾帧 0、TRANSFORMED 帧 0、
// overflow 全是 0）—— 只喂真实录像，这些规则永远测不到。
//
// 所以这里自己造录像：Presenter 的输入是**纯数据**（ReplayFile），合成一份比等一场真实对局便宜得多，
// 而且能把「优先级」「两向」「边界」这类判据写清楚。真实录像那边由 ui8 / ui14 盯着。
import { Presenter } from "../src/theater/presenter.ts";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const here = import.meta.dirname;

type Mem = any;
const mem = (id: number, name: string, over: Mem = {}): Mem => ({
  id, name, hp: 1000, maxHp: 1000, alive: true, hpZero: false, dead: false, killed: false, transformed: false,
  shields: [], statuses: [], effects: [], usedSkills: [],
  base: { atk: 100, def: 50, spd: 100, cri: 0, crid: 1.5, efh: 0, efr: 0 },
  ...over,
});

/** 造一份最小的 ReplayFile：两帧共用同一个 checkpoint 状态（帧只用来喂事件） */
function mkReplay(frames: any[], state: Mem) {
  return {
    schemaVersion: 2, createdAt: "2026-10-03T00:00:00.000Z", engineVersion: "synth", gameDataVersion: "synth",
    match: { id: "SYNTH", seed: 1, maxTurns: 60, policyIds: {}, red: ["甲"], blue: ["乙"] },
    frames: frames.map((f, i) => ({ frame: i, ev: null, depth: 0, ...f })),
    events: [],
    checkpoints: [{ frame: 0, state }],
    deltas: [],
    finalState: state,
    finalHash: "synth",
    result: { winner: 0, turns: 7, reason: "ALL_DEAD" },
  };
}
const st = (over: Mem = {}): Mem => ({
  schemaVersion: 2, battleId: "SYNTH", seed: 1, turn: 7, phase: "BATTLE", winner: null, endReason: "",
  startupDone: true, ended: false, rules: {}, policyIds: {}, busHandlers: 0, unknownBuffRefs: [], counts: {},
  teams: [
    { id: 0, members: [mem(101, "甲")], summons: [], orbs: { orb: 5, gauge: 2, cycle: 0, pendingReward: 0 } },
    { id: 1, members: [mem(201, "乙")], summons: [], orbs: { orb: 3, gauge: 4, cycle: 1, pendingReward: 0 } },
  ],
  timeline: { entries: [{ id: 101, pos: 5000, locked: false }, { id: 201, pos: 2500, locked: true }] },
  ...over,
});
const P = (frames: any[], state: Mem) => Presenter.fromSerialized(mkReplay(frames, state) as any);

sec("[1] 护盾：只算**未破**的盾，且盾量要在卡面上可读（审核 G4-1 的缺口）");
{
  const s = st();
  s.teams[0].members[0] = mem(101, "甲", { shields: [{ value: 300, broken: false }, { value: 200, broken: true }, { value: 100 }] });
  const p = P([{ t: "BATTLE_START" }], s);
  ok("★★★ 未破盾求和（300 + 100），**破掉的 200 不算** —— 只写「有 shield 字段」不算数", p.view(0).units[0].shield === 400, String(p.view(0).units[0].shield));
  const s2 = st();
  s2.teams[0].members[0] = mem(101, "甲", { shields: [{ value: 300, broken: true }] });
  ok("★★ 两向：盾全破了 ⇒ 0（不是 300）", P([{ t: "BATTLE_START" }], s2).view(0).units[0].shield === 0);
  const s3 = st();
  s3.teams[0].members[0] = mem(101, "甲", { shields: [{ value: 120 }, { value: 0 }] });
  ok("★ 缺 broken 字段按「未破」处理（老存档/新档都不能漏算）", P([{ t: "BATTLE_START" }], s3).view(0).units[0].shield === 120);
  const pf = P([{ t: "SHIELD_APPLY", src: 101, dst: 201, value: 250, skill: "护盾术" }], st());
  const flo = pf.view(0).floats;
  //   ★ 蓝方实体 id 是 201+i ⇒ unitId 是 b1（第一版写成 b2，是把 1-based 的偏移套错了位置）
  ok("★★ 套盾帧产出「盾 +250」飘字（tone=shield）—— 没有它，界面上的盾是凭空出现的", flo.length === 1 && flo[0].tone === "shield" && flo[0].unitId === "b1" && /250/.test(flo[0].text), JSON.stringify(flo));
}

sec("[2] 死亡状态机的**优先级**（五态，审核 G4-1：有实现无断言）");
{
  const s = st();
  s.teams[0].members = [
    mem(101, "存活", {}),
    mem(102, "血尽", { hp: 0, hpZero: true }),
    mem(103, "阵亡", { hp: 0, dead: true, hpZero: true }),
    mem(104, "击杀", { hp: 0, killed: true, dead: true, hpZero: true }),
    mem(105, "变形", { transformed: true, killed: true, dead: true, hpZero: true }),
  ];
  s.timeline.entries = s.teams[0].members.map((m: any) => ({ id: m.id, pos: 0, locked: false }));
  const v = P([{ t: "BATTLE_START" }], s).view(0);
  const stateOf = (n: string) => v.units.find((u: any) => u.name === n)?.state;
  ok("★★★ 五态各就各位：ALIVE / HP_ZERO / DEAD / KILLED / TRANSFORMED",
    stateOf("存活") === "ALIVE" && stateOf("血尽") === "HP_ZERO" && stateOf("阵亡") === "DEAD" && stateOf("击杀") === "KILLED" && stateOf("变形") === "TRANSFORMED",
    JSON.stringify(v.units.map((u: any) => u.name + "=" + u.state)));
  ok("★★★ 优先级是**固定的一条链**（transformed > killed > dead > hpZero > alive）—— 同时置位时不许随对象键序漂",
    stateOf("变形") === "TRANSFORMED" && stateOf("击杀") === "KILLED" && stateOf("阵亡") === "DEAD");
  ok("★★ 变形中的单位仍然 alive=true（变形不是死亡，卡面不能画成灰的）", v.units.find((u: any) => u.name === "变形")?.alive === true);
}

sec("[3] 鬼火与**溢出**（审核 G4-3：presenter 三处 overflow 行没有任何断言）");
{
  const ov = P([{ t: "ORB_GAIN", src: 101, before: 6, after: 8, overflow: 3 }], st());
  const b = ov.view(0).banner!;
  ok("★★★ 回火溢出必须写成一行（否则「+5 却只涨到 8」在界面上没法解释）",
    b.lines.some((l: any) => l.label === "Overflow" && l.value === "3" && l.tone === "warn"), JSON.stringify(b.lines));
  ok("★ 回火行本身也在（before → after）", b.lines.some((l: any) => l.label === "Onibi gain" && /6 → 8/.test(l.value)), JSON.stringify(b.lines));
  const noOv = P([{ t: "ORB_GAIN", src: 101, before: 4, after: 8, overflow: 0 }], st());
  ok("★★ 两向：overflow=0 时**不许**冒出溢出（0 不是「有溢出」）", !noOv.view(0).banner!.lines.some((l: any) => l.label === "Overflow"), JSON.stringify(noOv.view(0).banner!.lines));
  const rew = P([{ t: "ORB_REWARD", gained: 5, overflow: 2 }], st());
  ok("★★ ORB_REWARD 也有溢出（第二条实现点）", rew.view(0).banner!.lines.some((l: any) => l.label === "Overflow"), JSON.stringify(rew.view(0).banner!.lines));
  const field = P([{ t: "FIELD_PER_TURN", entity: 101, name: "龙首之玉", probability: null, gained: 2, orbsBefore: 7, orbsAfter: 8, overflow: 1 }], st());
  ok("★★ FIELD_PER_TURN 也有溢出（第三条实现点）", field.view(0).banner!.lines.some((l: any) => l.label === "Overflow"), JSON.stringify(field.view(0).banner!.lines));
  const team = ov.view(0).teams;
  ok("★ 队伍视图把鬼火/回火计数/存量为 UI 备好（卡面不许自己算）", team[0].orb === 5 && team[0].gauge === 2 && team[1].cycle === 1 && team[0].maxOrb === 8, JSON.stringify(team));
}

sec("[4] SKILL Banner 的三行：目标 / 鬼火 / 段数（审核 G4-4：只校验了 kind/skill/actor）");
{
  const p = P([{ t: "SKILL_CAST", actor: 101, target: 201, skill: "三段击", cost: 3, hits: 3 }], st());
  const b = p.view(0).banner!;
  ok("★★★ 目标解析成名字（不是 id、不是 undefined）", b.target === "乙" && b.actor === "甲", JSON.stringify({ actor: b.actor, target: b.target }));
  ok("★★★ 鬼火行 = 技能消耗", b.lines.some((l: any) => l.label === "Onibi" && l.value === "-3"), JSON.stringify(b.lines));
  ok("★★★ 段数行 = 命中数（多段技能必须写在 Banner 上，否则「打了几下」只能数飘字）", b.lines.some((l: any) => l.label === "Hits" && l.value === "3"), JSON.stringify(b.lines));
  ok("★ banner.cost 也带出来（组件不必回头查事件）", b.cost === 3, String(b.cost));
  /**
   * ★★★ 第 252 轮：**分段技能**的横幅 —— 引擎现在会把两段各自的次数写进 `SKILL_CAST.segments`；
   *   视图层只报首段的话，横幅就比产物乐观（262_03 写「3 段」而实际是 3 次全体 + 1 次单体）。
   */
  const seg = P([{ t: "SKILL_CAST", actor: 101, target: 201, skill: "两段击", cost: 3, hits: 3, segments: ["3x33%/全体", "1x88%/单体"] }], st());
  ok("★★★ 分段技能：段数行写的是**两段各自的次数**（第 252 轮）",
    seg.view(0).banner!.lines.some((l: any) => l.label === "Hits" && l.value === "3x33%/全体 + 1x88%/单体"), JSON.stringify(seg.view(0).banner!.lines));
  const one = P([{ t: "SKILL_CAST", actor: 101, target: 201, skill: "单段击", cost: 0, hits: 1 }], st());
  ok("★★ 两向：单段技能**不写**段数行（写了等于噪声）", !one.view(0).banner!.lines.some((l: any) => l.label === "Hits"), JSON.stringify(one.view(0).banner!.lines));
  const ghost = P([{ t: "SKILL_CAST", actor: 101, target: 999, skill: "打空气", cost: 1, hits: 1 }], st());
  ok("★★ 未知目标 → #999（不许变 undefined：那会在界面上显示成空白，看起来像没目标）", ghost.view(0).banner!.target === "#999", String(ghost.view(0).banner!.target));
  const fallback = P([{ t: "SKILL_FALLBACK", actor: 101, skill: "大招收", need: 4, have: 2, fallback: "普攻" }], st());
  ok("★★ 鬼火不足时 Banner 必须写清「需 4 / 有 2」与改成了什么",
    fallback.view(0).banner!.lines.some((l: any) => /4/.test(l.value) && /2/.test(l.value)) && fallback.view(0).banner!.lines.some((l: any) => l.label === "Instead" && l.value === "普攻"),
    JSON.stringify(fallback.view(0).banner!.lines));
}

sec("[5] 八维折叠 + Action Bar 的**速度变化**（审核 G4-2 的缺口）");
{
  const s = st();
  const p0 = P([{ t: "BATTLE_START" }], s);
  ok("★ 无 effects 时 spd = 基础值", p0.view(0).units[0].stats.spd === 100, String(p0.view(0).units[0].stats.spd));
  const s1 = st();
  s1.teams[0].members[0] = mem(101, "甲", { effects: [{ prop: "spd", mode: "FIXED", value: 20 }] });
  const p1 = P([{ t: "BATTLE_START" }], s1);
  ok("★★ FIXED +20 ⇒ 120", p1.view(0).units[0].stats.spd === 120, String(p1.view(0).units[0].stats.spd));
  const s2 = st();
  s2.teams[0].members[0] = mem(101, "甲", { effects: [{ prop: "spd", mode: "FIXED", value: 20 }, { prop: "spd", mode: "ADD_RATE", value: 0.5 }] });
  ok("★★★ FIXED 与 ADD_RATE 的折叠顺序：(100+20)×1.5 = 180（与 Entity.prop 同一套语义）", P([{ t: "BATTLE_START" }], s2).view(0).units[0].stats.spd === 180, String(P([{ t: "BATTLE_START" }], s2).view(0).units[0].stats.spd));
  const s3 = st();
  s3.teams[0].members[0] = mem(101, "甲", { effects: [{ prop: "spd", mode: "SET", value: 50 }, { prop: "spd", mode: "FIXED", value: 20 }] });
  ok("★★ SET 覆盖其余（=50，不是 70）", P([{ t: "BATTLE_START" }], s3).view(0).units[0].stats.spd === 50, String(P([{ t: "BATTLE_START" }], s3).view(0).units[0].stats.spd));
  const s4 = st();
  s4.teams[0].members[0] = mem(101, "甲", { effects: [{ prop: "spd", mode: "FIXED", value: -999 }] });
  ok("★★ 负到 0 以下不许出现负速度（行动条会算成负数位置）", P([{ t: "BATTLE_START" }], s4).view(0).units[0].stats.spd === 0, String(P([{ t: "BATTLE_START" }], s4).view(0).units[0].stats.spd));
  const s5 = st();
  s5.teams[0].members[0] = mem(101, "甲", { effects: [{ prop: "atk", mode: "FIXED", value: 50 }] });
  ok("★★ 两向：改 atk 不许动 spd（按 prop 过滤，不是「有 effects 就算」）", P([{ t: "BATTLE_START" }], s5).view(0).units[0].stats.spd === 100);
  // ★ 速度变化必须在**相邻两帧**上看得见 —— 这正是 Action Bar 显示的那个数字
  const f0 = st(), f1 = st();
  f1.teams[0].members[0] = mem(101, "甲", { effects: [{ prop: "spd", mode: "ADD_RATE", value: 0.3 }] });
  const rp = { ...mkReplay([{ t: "STATUS_APPLY", dst: 101, name: "加速", duration: 2 }, { t: "STATUS_APPLY", dst: 101, name: "加速", duration: 2 }], f0) };
  rp.checkpoints = [{ frame: 0, state: f0 }, { frame: 1, state: f1 }];
  const pp = Presenter.fromSerialized(rp as any);
  ok("★★★ 速度变化在相邻帧上是**可读的差**（Action Bar 读的就是这个数：100 → 130）",
    pp.view(0).units[0].stats.spd === 100 && pp.view(1).units[0].stats.spd === 130,
    pp.view(0).units[0].stats.spd + " → " + pp.view(1).units[0].stats.spd);
}

sec("[6] 回合：从重建出来的状态读（本轮修的真 bug）");
{
  const s = st();
  const p = P([{ t: "BATTLE_START" }, { t: "DAMAGE", src: 101, dst: 201, applied: 10 }], s);
  ok("★★★ 帧上没有 turn 字段时，回合数从 state 读（原来恒为 0 ⇒ 顶栏「第 0 回合」+ ⏭ 直接跳末帧）", p.view(0).turn === 7 && p.view(1).turn === 7, JSON.stringify([p.view(0).turn, p.view(1).turn]));
  const s2 = st({ turn: 0 });
  ok("★★ 两向：state.turn = 0 就是 0（不是被兜底逻辑顶成别的值）", P([{ t: "BATTLE_START" }], s2).view(0).turn === 0);
  const s3 = st({ turn: 12 });
  const p3 = P([{ t: "BATTLE_START", turn: 3 }], s3);
  ok("★ 帧上带 turn 时以**状态**为准（帧上那个是事件自己的载荷，两处不一致时真相只有一处）", p3.view(0).turn === 12, String(p3.view(0).turn));
}

sec("[7] 行动条：位置归一到 [0,1] 并夹取，锁定标记透传");
{
  const p = P([{ t: "BATTLE_START" }], st());
  const v = p.view(0);
  ok("★ pos 5000/10000 ⇒ 0.5；2500/10000 ⇒ 0.25", v.units[0].timeline === 0.5 && v.units[1].timeline === 0.25, JSON.stringify(v.units.map((u: any) => u.timeline)));
  ok("★ locked 透传到视图（被锁的行动条要画成不能动）", v.units[1].locked === true && v.units[0].locked === false);
  const s = st({ timeline: { entries: [{ id: 101, pos: 99999, locked: false }, { id: 201, pos: -50, locked: false }] } });
  const v2 = P([{ t: "BATTLE_START" }], s).view(0);
  ok("★★ 两向夹取：超上限 ⇒ 1；负数 ⇒ 0（否则 Action Bar 的百分比会画到画布外）", v2.units[0].timeline === 1 && v2.units[1].timeline === 0, JSON.stringify(v2.units.map((u: any) => u.timeline)));
}

sec("[8] Buff Hover 的数据来源（审核 G4-5：只剩模板 title 没断言）");
{
  const s = st();
  s.teams[0].members[0] = mem(101, "甲", { statuses: [{ defId: "buff_1", stacks: 3, remaining: 2, tag: "BUFF", effects: [{ prop: "atk", mode: "FIXED", value: 10 }] }] });
  const v = P([{ t: "BATTLE_START" }], s).view(0);
  const stv = v.units[0].statuses[0];
  ok("★★ Hover 要显示的三样（剩余回合 / 层数 / 生效效果数）都透传了", stv.remaining === 2 && stv.stacks === 3 && stv.effects === 1, JSON.stringify(stv));
  const card = fs.readFileSync(path.join(here, "..", "src", "components", "theater", "EntityCard.vue"), "utf8");
  /**
   * ★★★ 第一版这里断言的是「卡面 title 有 remaining/stacks/effects」—— 跑出来红了，而且**不是断言写错**：
   *   effects（该状态携带的生效效果条数）presenter 一直在算，界面上**从来没有读者**。
   *   于是给了它一个读者（Hover 里多一项「生效效果 N 项」），这条断言才成立。
   *   ——「有字段没读者」是这套代码库反复栽跟头的地方，这次是断言把它逼出来的。
   */
  ok("★★★ 卡面 title 真的把剩余/层数/生效效果数写进去了（数据到了视图，没到模板就等于没有）",
    /remaining/.test(card) && /stacks/.test(card) && /s\.effects/.test(card) && /:title=/.test(card));
  ok("★★ 而且只在**有效果**时才写（0 项是噪声）", /s\.effects \?/.test(card));
  const deb = P([{ t: "BATTLE_START" }], (() => { const x = st(); x.teams[1].members[0] = mem(201, "乙", { statuses: [{ defId: "CONTROL_stun", stacks: 1, remaining: 1, tag: "CONTROL", effects: [] }] }); return x; })()).view(0);
  ok("★★ 减益/控制的分类由 defId 判（不是靠名字猜）—— 卡面据此配色", deb.units[1].statuses[0].isDebuff === true && deb.units[0].statuses.length === 0);
}

sec("[8] ★★★ 计数器（层数型状态）：层数上 Banner、生命周期合成一段、被消耗 ≠ 到期（第 240 轮）");
{
  const frames = [
    { t: "STATUS_APPLY", src: 101, dst: 101, status: "GHOST_EYE", name: "鬼眸", merged: false, stacks: 1, threshold: 5, tag: "st9", duration: null, note: "COUNTER_STACK" },
    { t: "STATUS_APPLY", src: 101, dst: 101, status: "GHOST_EYE", name: "鬼眸", merged: true, stacks: 2, threshold: 5, tag: "st9", duration: null, note: "COUNTER_STACK" },
    { t: "STATUS_APPLY", src: 101, dst: 101, status: "GHOST_EYE", name: "鬼眸", merged: true, stacks: 5, threshold: 5, tag: "st9", duration: null, note: "COUNTER_STACK" },
    { t: "STATUS_EXPIRE", id: 101, status: "GHOST_EYE", name: "鬼眸", stacks: 5, reason: "COUNTER_SPENT" },
  ];
  const p = P(frames, st());
  const b0 = p.view(0).banner!;
  ok("★★★ 层数型状态显示「层数 1 / 5」而不是「持续 99999 回合」（GLOBAL 策略的时长是噪声）",
    b0.lines.some((l: any) => l.label === "Stacks" && l.value === "1 / 5") && !b0.lines.some((l: any) => l.label === "Duration"), JSON.stringify(b0.lines));
  ok("★★★ 涨到第 5 层时 Banner 上读得到 5 / 5", p.view(2).banner!.lines.some((l: any) => l.label === "Stacks" && l.value === "5 / 5"), JSON.stringify(p.view(2).banner!.lines));
  const b3 = p.view(3).banner!;
  ok("★★★ 清零写「消耗」（不是「到期」），且原因具名 COUNTER_SPENT",
    b3.lines.some((l: any) => l.label === "Consumed" && l.value === "GHOST_EYE") && b3.lines.some((l: any) => l.label === "Reason" && l.value === "COUNTER_SPENT"), JSON.stringify(b3.lines));
  const tl = p.statusTimeline().filter((r: any) => r.status === "GHOST_EYE");
  ok("★★★ 同一个实例的重复施加合并成**一段**生命周期（3 次施加 ⇒ 1 条记录，层数取最新 5）",
    tl.length === 1 && tl[0].stacks === 5 && tl[0].threshold === 5 && tl[0].reapplied === 3, JSON.stringify(tl));
  ok("★★ 那段生命周期在清零帧**闭合**（to 有值、expired=true）—— Hover 上不是一段永远开着的历史",
    tl.length === 1 && tl[0].to === 3 && tl[0].expired === true, JSON.stringify(tl));
  const skillApply = P([{ t: "STATUS_APPLY", src: 101, dst: 201, status: "2002_1", name: "印记", duration: 3, tag: "st1", known: true, skill: "测试" }], st()).view(0).banner!;
  ok("★★★ 反向：技能施加的状态（没有 stacks 字段）**照旧**显示「持续 3 回合」—— 这条分支没有碰既有录像",
    skillApply.lines.some((l: any) => l.label === "Duration" && l.value === "3 turns") && !skillApply.lines.some((l: any) => l.label === "Stacks"), JSON.stringify(skillApply.lines));
  ok("★★★ 反向：既有的「被消耗」两类（免死/自复活）现在也说得出原因，而不是笼统的「到期」",
    P([{ t: "STATUS_EXPIRE", id: 101, status: "2072_1", name: "九命", stacks: 4, reason: "SELF_REVIVE_CONSUMED" }], st()).view(0).banner!.lines.some((l: any) => l.label === "Consumed"), "SELF_REVIVE_CONSUMED 应显示为消耗");
}

console.log("\n=== Presenter 合成录像（护盾/状态/溢出/Banner/速度）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
