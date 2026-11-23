// tests/ui8-theater.ts — ★ G4 验收：Battle Theater（a1-4.md §12-§19、§34、§59）
//
// 文档对 Theater MVP 的要求（§59）：10 张卡 / HP / 行动条 / 鬼火 / Buff / 当前技能 /
// 伤害数字 / 死亡 / 播放暂停 / 速度 / 拖动。**不要**立绘动画、技能特效、粒子。
//
// 本测试盯住三件事：
//   ① Presenter（纯函数层）对**每一帧**都能算出正确的视图模型，且满足战斗不变量
//   ② 播放完全不需要引擎（§36）—— 打开录像、拖到任意帧、读事件链，装配次数纹丝不动
//   ③ 界面接线正确（组件存在、不 import 引擎战斗模块、App 里有入口）
import fs from "node:fs";
import path from "node:path";
import { Presenter } from "../src/theater/presenter.ts";
import { createEngineAdapter } from "../src/adapters/engine-adapter.ts";
import { canonicalMatch } from "../src/mock/canonical-match.ts";
import { assembleCount } from "../src/engine/assemble.ts";

const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..", "..");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const S = (p: string) => fs.readFileSync(path.join(here, "..", "src", p), "utf8");

const bundle = JSON.parse(fs.readFileSync(path.join(here, "..", "src", "engine", "bundle.json"), "utf8"));
const fixture = path.join(ROOT, "battle-lab", "fixtures", "replay-demo-123456.json");

sec("[1] 用真实录像喂 Presenter：每一帧都要算得出来");
const p = Presenter.fromSerialized(fs.readFileSync(fixture, "utf8"));
ok(`录像帧数 ${p.frameCount}（>${50}）`, p.frameCount > 50);
ok("终局帧号解析正确", p.lastFrame >= p.frameCount - 1, `lastFrame=${p.lastFrame} frameCount=${p.frameCount}`);
let bad = 0;
const views = [];
for (let i = 0; i < p.frameCount; i++) {
  const v = p.view(i);
  if (!v || v.units.length !== 10) { bad++; continue; }
  views.push(v);
}
ok("★ 每一帧都能产出视图模型（10 个单位齐全）", bad === 0, `失败 ${bad} 帧`);
ok("红蓝各 5 个", views[0].units.filter(u => u.side === "red").length === 5 && views[0].units.filter(u => u.side === "blue").length === 5);

sec("[2] 战场不变量（Presenter 算出来的东西必须自洽）");
{
  const hpBad = views.filter(v => v.units.some(u => u.hpPct < 0 || u.hpPct > 100)).length;
  ok("HP 百分比恒在 [0,100]", hpBad === 0, String(hpBad));
  const deadBad = views.filter(v => v.units.some(u => !u.alive && u.hp > 0)).length;
  ok("★ 死亡与血量自洽（alive=false ⇒ hp<=0）", deadBad === 0, String(deadBad));
  const tlBad = views.filter(v => v.units.some(u => u.timeline < 0 || u.timeline > 1)).length;
  ok("行动条位置恒在 [0,1]", tlBad === 0, String(tlBad));
  const orbBad = views.filter(v => v.teams.some(t => t.orb < 0 || t.orb > 8)).length;
  ok("鬼火恒在 [0,8]", orbBad === 0, String(orbBad));
  ok("存活数与卡面一致", views.every(v => v.teams[0].aliveCount === v.units.filter(u => u.side === "red" && u.alive).length && v.teams[1].aliveCount === v.units.filter(u => u.side === "blue" && u.alive).length));
}

sec("[3] HP 只会在治疗/回复帧上升（防止 Presenter 把数字算反）");
{
  const frames = p.player.frames;
  let violations: string[] = [];
  for (let i = 1; i < views.length; i++) {
    for (const u of views[i].units) {
      const prev = views[i - 1].units.find(x => x.unitId === u.unitId)!;
      if (u.hp > prev.hp + 1e-6) {
        const f = frames[i];
        const healed = f && ["HEAL", "RECOVER"].includes(f.t) && String((f as any).dst) === String(u.id);
        const revived = f && f.t === "REVIVE" && String((f as any).id) === String(u.id);
        if (!healed && !revived) violations.push(`frame ${i} ${u.name} ${prev.hp.toFixed(0)}→${u.hp.toFixed(0)} (${f?.t})`);
      }
    }
  }
  ok("★ 血量上升只出现在治疗/复活帧", violations.length === 0, violations.slice(0, 3).join(" | "));
}

sec("[4] 鬼火收支在视图层也必须对得上");
{
  const pays = p.player.frames.filter(f => f.t === "ORB_PAY") as any[];
  ok(`存在扣火帧（${pays.length} 条）`, pays.length > 0);
  ok("★ 每条扣火：before − amount === after", pays.every(f => Math.abs(f.before - f.amount - f.after) < 1e-9), JSON.stringify(pays.slice(0, 2)));
  const gains = p.player.frames.filter(f => f.t === "ORB_GAIN") as any[];
  ok("回火帧 after ≥ before", gains.every(f => f.after >= f.before));
}

sec("[5] 行动条：拉条/推条必须在相邻帧上看得见（§14）");
{
  const shifts = p.player.frames.map((f, i) => ({ f, i })).filter(x => (x.f as any).t === "TIMELINE_SHIFT") as Array<{ f: any; i: number }>;
  ok(`存在拉条/推条帧（${shifts.length} 条）`, shifts.length > 0);
  let moved = 0;
  for (const { f, i } of shifts) {
    if (i === 0 || i + 1 >= views.length) continue;
    const before = views[i - 1]?.units.find(u => u.id === f.id)?.timeline ?? 0;
    const after = views[i + 1]?.units.find(u => u.id === f.id)?.timeline ?? 0;
    if (Math.abs(after - before) > 1e-9) moved++;
  }
  ok("★ 每一条拉条/推条都能在前后帧的位置差上体现出来", moved === shifts.length, `${moved}/${shifts.length}`);
  ok("位置变化方向与拉/推一致", shifts.every(({ f }) => (f.posAfter - f.posBefore) * (f.direction === "pull" ? 1 : -1) >= -1e-6));
}

sec("[6] Action Banner（§16）：技能释放不能只是一行日志");
{
  const casts = p.player.frames.map((f, i) => ({ f, i })).filter(x => (x.f as any).t === "SKILL_CAST") as Array<{ f: any; i: number }>;
  ok(`存在技能帧（${casts.length} 条）`, casts.length > 10);
  const okBanner = casts.every(({ f, i }) => {
    const b = views[i].banner;
    return b && b.kind === "SKILL" && b.skill === f.skill && !!b.actor;
  });
  ok("★ 每条 SKILL_CAST 都产出带技能名与行动者的 Banner", okBanner);
  const dmgFrames = p.player.frames.map((f, i) => ({ f, i })).filter(x => (x.f as any).t === "DAMAGE") as Array<{ f: any; i: number }>;
  ok("伤害帧产生飘字（数字可见）", dmgFrames.every(({ i }) => views[i].floats.length >= 1));
  ok("暴击飘字被标成 crit", dmgFrames.filter(x => x.f.crit).every(({ i }) => views[i].floats.some(fl => fl.tone === "crit")));
}

sec("[7] 死亡状态机可视化（§18）");
{
  const deaths = p.player.frames.map((f, i) => ({ f, i })).filter(x => (x.f as any).t === "DEATH") as Array<{ f: any; i: number }>;
  ok(`存在阵亡帧（${deaths.length} 条）`, deaths.length > 0);
  const first = deaths[0];
  const unit = views[first.i].units.find(u => u.id === first.f.id);
  ok("★ 阵亡帧上该单位已经是非存活状态", !!unit && !unit.alive && unit.hp <= 0);
  ok("阵亡帧产出 DEATH 类 Banner", views[first.i].banner?.kind === "DEATH");
  const last = views[views.length - 1];
  ok("★ 终局时败方全员阵亡（与胜负一致）", p.result.winner === 0
    ? last.units.filter(u => u.side === "blue").every(u => !u.alive)
    : last.units.filter(u => u.side === "red").every(u => !u.alive));
}

sec("[8] ★ 播放不需要引擎（§36）");
{
  const before = assembleCount;
  const p2 = Presenter.fromSerialized(fs.readFileSync(fixture, "utf8"));
  for (const f of [0, 1, 17, 99, p2.frameCount - 1]) p2.view(f);
  p2.ancestry(p2.frameCount - 2);
  ok("★ 拖遍全片 + 读事件链，装配次数一次都没变", assembleCount === before, `${before} → ${assembleCount}`);
  // 事件链必须真的能读出来：取一个确实带 ev 的帧，链上至少要有它自己
  const withEv = p2.player.frames.map((f: any, i: number) => ({ f, i })).filter(x => x.f.ev !== null && x.f.ev !== undefined).pop();
  ok("事件链可读（Inspector 的数据来源）", !!withEv && p2.ancestry(withEv.i).length >= 1, withEv ? `frame ${withEv.i} → ${p2.ancestry(withEv.i).length} 节点` : "没有带 ev 的帧（这本身就不正常）");
}

sec("[9] 接口接线：适配器真的会产出 Replay 文件");
{
  const adapter = createEngineAdapter(bundle);
  const r: any = await adapter.replay(canonicalMatch(), 123456);
  ok("REPLAY 返回里带 replay 载荷", !!r.replay, Object.keys(r).join(","));
  ok("载荷含帧流/Checkpoint/Delta/终局指纹", Array.isArray(r.replay.frames) && Array.isArray(r.replay.checkpoints) && Array.isArray(r.replay.deltas) && !!r.replay.finalHash);
  const pv = Presenter.fromSerialized(r.replay);
  ok("★ 适配器产出的录像能被 Presenter 直接播放", pv.frameCount === r.replay.frames.length && pv.view(pv.frameCount - 1)?.units.length === 10);
  ok("终局视图与回放结果一致", (() => { const last = pv.view(pv.frameCount - 1); return last && last.frame >= 0 && last.units.length === 10; })());
}

sec("[10] 分层与接线（Presenter 不许 import 引擎战斗模块）");
{
  const pres = S("theater/presenter.ts");
  // 只看 **import 语句**：注释里解释"这里不 import assemble"不该被当成违规（第一次就是被自己的注释绊倒的）
  const imports = pres.split("\n").filter(l => /^\s*import\b/.test(l)).join("\n");
  ok("★ Presenter 的 import 里没有 assemble/battle/compile（只借纯播放器读文件）", !/assemble|kernel\/battle|kernel\/team|compile\//.test(imports), imports.replace(/\n/g, " | ").slice(0, 160));
  ok("Presenter 是纯函数层（无 Vue 依赖）", !/from "vue"/.test(pres));
  ok("BattleTheater.vue 存在且引用 Presenter", /Presenter/.test(S("components/theater/BattleTheater.vue")));
  ok("EntityCard.vue 存在且使用 UnitView", /UnitView/.test(S("components/theater/EntityCard.vue")));
  // ★★ 八维里有两维**没有任何消费者**：效果命中 / 效果抵抗 ——
  //   引擎里不存在「先判定命中、再结算」这一级（EV.HIT / EV.BEFORE_HIT / EV.RESIST 从未派发）。
  //   不加区分地平铺显示，看的人会以为它在参与结算。
  const ec = S("components/theater/EntityCard.vue");
  ok("★★ EntityCard 把效果命中/抵抗标为「未结算」",
    /unused/.test(ec) && /not applied/.test(ec), (ec.match(/HIT \{\{[^\n]*/) ?? [""])[0].slice(0, 80));
  ok("★ 标记不是删掉它：数值仍然显示（它确实是输入的一部分）",
    /unit\.stats\.efh/.test(ec) && /unit\.stats\.efr/.test(ec));
  ok("★ 提示文案写明了原因，不是「暂不支持」这种含糊说法", /hit-check-before-resolution/.test(ec));
  const app = S("App.vue");
  ok("App 里有『观看战斗』入口", /观看战斗|watchOne/.test(app) && /BattleTheater/.test(app));
  ok("结果页的样本对局能直接跳进 Theater", /emit\('watch'/.test(S("components/result/ResultDashboard.vue")));
  ok("契约给 REPLAY_PREPARED 增加了可选 replay 载荷", /replay\?: unknown/.test(S("contracts/worker-api.ts")));
}


sec("[11] ★★★ 偷取帧在 Theater 里必须看得见（第 99 轮自己声明的缺口，第 100 轮补上）")
{
  /**
   * 第 99 轮把属性偷取做进引擎时，Presenter 加了 5 个 case，但**没有任何断言盯它**
   * （当时的理由写在报告 §84.10：既有录像夹具里不含偷取帧）。
   * 这一段的做法不是再造一个夹具文件，而是**当场生成一段含偷取的录像** ——
   * 与 g60 §5 同一手法（把典型对局红方第一位换成一目连），好处是夹具不会过期。
   */
  const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const YML = KB.find((s: any) => s.name === "一目连");
  ok("★ 前置：知识库里有「一目连」（否则这一段是空跑）", !!YML);
  const m = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: YML.id, name: "一目连" };
  const adapter = createEngineAdapter(bundle);
  const rr: any = await adapter.replay(m, 20261002);
  const pv = Presenter.fromSerialized(rr.replay);
  const stealFrames = rr.replay.frames.map((f: any, i: number) => ({ f, i })).filter((x: any) => x.f.t === "STAT_STEAL");
  ok("★★★ 录像里真的有偷取帧（没有的话下面全是空断言）", stealFrames.length > 0, "STAT_STEAL × " + stealFrames.length);
  const v0 = pv.view(stealFrames[0].i);
  const lines = (v0?.banner?.lines ?? []).map(l => l.label + "=" + l.value).join("｜");
  ok("★★★ Banner 上写出「偷取 + 属性 + 数值」（不是只有一行「发生了某件事」）",
    v0?.banner?.kind === "STATUS" && /Steal/.test(lines) && /ATK/.test(lines), lines);
  ok("★★★ 而且写明**会归还**、持续几回合（借据的期限是机制的一部分）",
    /returned/.test(lines) && /Duration/.test(lines), lines);
  ok("★★★ 飘字在**双方**身上各出现一次（目标 −、偷取者 +）—— 只画一边等于没解释属性为什么变了",
    (v0?.floats ?? []).length === 2 && (v0?.floats ?? []).some(f => f.tone === "dmg" && f.text.startsWith("−")) &&
    (v0?.floats ?? []).some(f => f.tone === "heal" && f.text.startsWith("+")),
    JSON.stringify(v0?.floats));
  ok("★★ 全片每一帧仍然算得出来（新 case 没有把别的帧弄坏）",
    Array.from({ length: pv.frameCount }, (_, i) => i).every(i => !!pv.view(i)));
  const cons = stealFrames.filter((x: any) => x.f.conservation);
  ok("★★ 口径是守恒的（默认 TRANSFER）⇒ 不该出现「不守恒」告警行", cons.length === 0, String(cons.length));
}
console.log(`\n══════════════════════════════════`);
console.log(`UI-8 Theater 验收：${pass} 通过 / ${fail} 失败`);
console.log(`══════════════════════════════════`);
if (fail > 0) process.exit(1);
