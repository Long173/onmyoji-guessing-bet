// tests/ui14-transport.ts — ★★★ 第 137 轮：**播放控制**的验收（G4 唯一「实现有、验收无」的那一项）
//
// 第 137 轮审核的结论：BattleTheater.vue 里有 play/stop/stepBy/nextKeyFrame/nextTurn/goto 的实现，
// 但 apps/web/tests 全库搜 nextKeyFrame|scrub|stepBy|倍速 —— 0 命中。根因是这些函数长在
// <script setup> 里，本仓库又没有 jsdom / @vue/test-utils。
//
// 处置：逻辑搬进 src/theater/transport.ts（纯函数 + host 接口），这个文件按项目纪律配
// **正反两面**：合法输入的行为 + 非法/边界输入不许静默失效 + 组件接线不许把逻辑抄回去。
import fs from "node:fs";
import path from "node:path";
import { createTransport, frameIntervalMs, SPEEDS, KEY_FRAME_KINDS, MIN_INTERVAL_MS, BASE_INTERVAL_MS } from "../src/theater/transport.ts";
import { Presenter } from "../src/theater/presenter.ts";

const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..", "..");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const S = (p: string) => fs.readFileSync(path.join(here, "..", "src", p), "utf8");

/** 用两个普通变量实现 host —— 这就是「纯逻辑 + 状态在宿主」的意义：不需要 Vue、不需要 DOM */
function mkHost(idx = 0, playing = false) {
  const st = { idx, playing };
  return {
    st,
    host: { getIdx: () => st.idx, setIdx: (i: number) => { st.idx = i; }, getPlaying: () => st.playing, setPlaying: (p: boolean) => { st.playing = p; } },
  };
}

sec("[1] 倍速 → 间隔：非法速度不许退化成「尽快跑」");
{
  ok("★ 1× = " + BASE_INTERVAL_MS + "ms", frameIntervalMs(1) === BASE_INTERVAL_MS, String(frameIntervalMs(1)));
  ok("★ 2× = 150ms", frameIntervalMs(2) === 150, String(frameIntervalMs(2)));
  ok("★ 0.5× = 600ms（慢放也要真的慢）", frameIntervalMs(0.5) === 600, String(frameIntervalMs(0.5)));
  ok("★★ 100× 被下限 25ms 拦住（不是 3ms —— 那会让一帧跑几十次）", frameIntervalMs(100) === MIN_INTERVAL_MS, String(frameIntervalMs(100)));
  ok("★★★ 0× / 负数 / NaN / Infinity 一律退回 1×（否则 setInterval 拿到 0 或 NaN，界面像卡死）",
    frameIntervalMs(0) === BASE_INTERVAL_MS && frameIntervalMs(-2) === BASE_INTERVAL_MS && frameIntervalMs(NaN) === BASE_INTERVAL_MS && frameIntervalMs(Infinity) === BASE_INTERVAL_MS,
    JSON.stringify([frameIntervalMs(0), frameIntervalMs(-2), frameIntervalMs(NaN), frameIntervalMs(Infinity)]));
  ok("★ 倍速档位里有 1×（组件的默认速度必须是一个真档位，否则按钮上没有任何一个高亮）", SPEEDS.includes(1), JSON.stringify(SPEEDS));
  ok("★ 倍速档位单调递增且去重（控制条按这个顺序画）", SPEEDS.every((s, i) => i === 0 || s > SPEEDS[i - 1]), JSON.stringify(SPEEDS));
}

sec("[2] goto：夹取、四舍五入、非有限数不许进 idx");
{
  const mk = (n: number) => { const h = mkHost(); return { h, t: createTransport({ host: h.host, frameCount: () => n, events: () => [], turnAt: () => 0 }) }; };
  const { h, t } = mk(10);
  t.goto(3); ok("★ 正常跳帧", h.st.idx === 3, String(h.st.idx));
  t.goto(-5); ok("★ 负数夹到 0", h.st.idx === 0, String(h.st.idx));
  t.goto(999); ok("★ 越界夹到末帧", h.st.idx === 9, String(h.st.idx));
  t.goto(4.6); ok("★ 小数四舍五入（拖动进度条给的是字符串化的小数）", h.st.idx === 5, String(h.st.idx));
  const before = h.st.idx;
  t.goto(NaN); ok("★★★ NaN 不许进 idx（Math.min/max 都拦不住 NaN —— 夹取会整体失效，界面白屏且不报错）", h.st.idx === before, String(h.st.idx));
  //   ★ 写这条时我第一版期望的是「Infinity 会被夹到末帧」——**错了**：Infinity 也属于非有限数，
  //     按同一条规矩应当**不动**（让它夹到末帧等于"错的值也有确定行为"，反而更难发现调用方算错了）。
  const prev2 = h.st.idx;
  t.goto(Infinity); ok("★★ Infinity 同样不动（非有限数的处置只有一条：不改变当前帧）", h.st.idx === prev2, prev2 + " → " + h.st.idx);
  const empty = mk(0); empty.t.goto(5); ok("★ 零帧录像：idx 只能是 0（不许出现 -1 这种越界下标）", empty.h.st.idx === 0, String(empty.h.st.idx));
}

sec("[3] 单步与播放/暂停的状态机");
{
  const h = mkHost(5, false);
  const t = createTransport({ host: h.host, frameCount: () => 20, events: () => [], turnAt: () => 0 });
  t.play(); ok("★ play 后进入播放态", h.st.playing === true);
  t.stepBy(1); ok("★★★ 单步必须**暂停播放**（否则单步一下就被计时器接管，用户按不住）", h.st.playing === false && h.st.idx === 6, JSON.stringify(h.st));
  t.stepBy(-2); ok("★ 反向单步", h.st.idx === 4, String(h.st.idx));
  t.play(); t.toggle(); ok("★ toggle 在播放中 → 暂停", h.st.playing === false);
  t.toggle(); ok("★ toggle 在暂停中 → 播放", h.st.playing === true);
  t.stop(); ok("★ stop", h.st.playing === false);
}

sec("[4] tick：推进一帧，到末尾自动停止");
{
  const h = mkHost(0, true);
  const t = createTransport({ host: h.host, frameCount: () => 3, events: () => [], turnAt: () => 0 });
  ok("★ 播放中 tick 推进一帧并返回 true", t.tick() === true && h.st.idx === 1, JSON.stringify(h.st));
  ok("★ 再 tick → 2", t.tick() === true && h.st.idx === 2, JSON.stringify(h.st));
  ok("★★★ 到末帧 tick 返回 false 且**自动停止**（返回值就是让组件清掉 setInterval 的信号）", t.tick() === false && h.st.playing === false && h.st.idx === 2, JSON.stringify(h.st));
  ok("★ 末尾再 tick 不会越界", t.tick() === false && h.st.idx === 2, JSON.stringify(h.st));
}

sec("[5] nextKeyFrame：跳过无用帧，落到真的关键时刻");
{
  const evs = [{ t: "BATTLE_START" }, { t: "ORB_GAIN" }, { t: "DAMAGE" }, { t: "ORB_GAIN" }, { t: "DEATH" }, { t: "ORB_GAIN" }];
  const mk2 = (idx: number) => { const h = mkHost(idx); return { h, t: createTransport({ host: h.host, frameCount: () => evs.length, events: () => evs, turnAt: () => 0 }) }; };
  const a = mk2(0); a.t.nextKeyFrame(1);
  ok("★★ 向后跳到第 2 帧（DAMAGE），而不是第 1 帧（ORB_GAIN 不是关键时刻）", a.h.st.idx === 2, String(a.h.st.idx));
  a.t.nextKeyFrame(1); ok("★★ 再向后再跳（跳过了中间的 ORB_GAIN）", a.h.st.idx === 4, String(a.h.st.idx));
  a.t.nextKeyFrame(1); ok("★ 后面没有关键时刻了 ⇒ 落到末帧", a.h.st.idx === 5, String(a.h.st.idx));
  a.t.nextKeyFrame(-1); ok("★ 反向跳回第 4 帧（DEATH）", a.h.st.idx === 4, String(a.h.st.idx));
  const b = mk2(5); b.t.nextKeyFrame(1); ok("★ 已在末帧再向后 ⇒ 还是末帧", b.h.st.idx === 5, String(b.h.st.idx));
  const c = mk2(0); c.t.nextKeyFrame(-1); ok("★ 首帧再向前 ⇒ 回到 0", c.h.st.idx === 0, String(c.h.st.idx));
  const d = mk2(3); d.st = d.h.st; d.t.play();
  const t0 = Date.now();
  d.t.nextKeyFrame(0);
  ok("★★★ dir=0 立刻返回且必须暂停播放（i += 0 会让这个循环永远转下去 —— 整页卡死）", Date.now() - t0 < 1000 && d.h.st.playing === false && d.h.st.idx === 3, JSON.stringify(d.h.st));
}

sec("[6] nextTurn：按回合跳，而不是按帧");
{
  const turn = [0, 0, 1, 1, 1, 2, 2];
  const mk3 = (idx: number) => { const h = mkHost(idx); return { h, t: createTransport({ host: h.host, frameCount: () => turn.length, events: () => turn.map(() => ({ t: "DAMAGE" })), turnAt: (i: number) => turn[i] ?? 0 }) }; };
  const a = mk3(1); a.t.nextTurn(1);
  ok("★★★ 跳到**下一个回合的第一帧**（第 2 帧，turn 0→1）", a.h.st.idx === 2, String(a.h.st.idx));
  a.t.nextTurn(1); ok("★ 再跳一个回合（第 5 帧）", a.h.st.idx === 5, String(a.h.st.idx));
  a.t.nextTurn(1); ok("★ 没有更后面的回合 ⇒ 末帧", a.h.st.idx === 6, String(a.h.st.idx));
  //   ★ 镜像对称：向前落在下一回合的**第一帧**，往回落在上一回合的**最后一帧**（扫描方向决定）。
  //     第一版期望 5（=向前落点的镜像）—— 那是把对称想成了"同一边"，断言写错，不是代码错。
  a.t.nextTurn(-1); ok("★★ 往回跳一个回合 ⇒ 落在上一回合的最后一帧（与向前落在第一帧镜像对称）", a.h.st.idx === 4, String(a.h.st.idx));
  const z = mk3(4); z.t.play(); const t1 = Date.now(); z.t.nextTurn(0);
  ok("★★ dir=0 立刻返回（同一处契约）", Date.now() - t1 < 1000 && z.h.st.idx === 4, String(z.h.st.idx));
}

sec("[7] 喂真实录像：关键时刻必须真的落在 KEY_FRAME_KINDS 上");
{
  const fixture = path.join(ROOT, "battle-lab", "fixtures", "replay-demo-123456.json");
  const p = Presenter.fromSerialized(fs.readFileSync(fixture, "utf8"));
  const events = p.player.frames as any[];
  const mk4 = () => { const h = mkHost(0); return { h, t: createTransport({ host: h.host, frameCount: () => p.frameCount, events: () => events, turnAt: (i: number) => p.view(i)?.turn ?? 0 }) }; };
  const keys = new Set(KEY_FRAME_KINDS);
  const a = mk4();
  const landed: number[] = [];
  for (let k = 0; k < 8; k++) { a.t.nextKeyFrame(1); landed.push(a.h.st.idx); }
  ok("★★★ 连续 8 次「下一个关键时刻」每次都真的停在一个关键时刻上（不是逐帧挪，也不是停在意料之外的帧）",
    landed.every(i => keys.has(String(events[i]?.t))) && new Set(landed).size === landed.length && landed.every((v, i) => i === 0 || v > landed[i - 1]),
    JSON.stringify(landed.map(i => i + ":" + events[i]?.t)));
  const b = mk4();
  b.t.nextKeyFrame(1); const at = b.h.st.idx;
  b.t.stepBy(-1); b.t.stepBy(1);
  ok("★★ 前进一步再后退一步 ⇒ 回到原处（帧号推进是可逆的）", b.h.st.idx === at, at + " → " + b.h.st.idx);
  const c = mk4();
  let jumped = 0;
  for (let k = 0; k < 5; k++) { const was = c.h.st.idx; c.t.nextTurn(1); if (c.h.st.idx !== was) jumped++; }
  ok("★ 连续 5 次「下一回合」每次都能真的前进（真录像里回合数够多）", jumped === 5, String(jumped));
  /**
   * ★★★ 第 137 轮实测抓到的真 bug：回放帧上**没有 turn 字段**（当时 597 帧里只有 1 帧带；第 244 轮起 599 帧），
   *   而 Presenter 写的是 fr?.turn ?? 0 ⇒ 整场「第 N 回合」都是 0、⏭ 下一回合直接跳末帧。
   *   下面三条把「回合」这件事钉死（它们就是发现那个 bug 的那张网）。
   */
  const turns = Array.from({ length: p.frameCount }, (_, i) => p.view(i)?.turn ?? -1);
  ok("★★★ 回合必须能读出来（不许整场恒为 0）", new Set(turns).size >= 10 && Math.max(...turns) >= 10,
    "distinct=" + new Set(turns).size + " max=" + Math.max(...turns));
  ok("★★★ 回合单调不减（帧号前进时回合不许倒退）", turns.every((t, i) => i === 0 || t >= turns[i - 1]),
    JSON.stringify(turns.filter((t, i) => i > 0 && t < turns[i - 1]).slice(0, 5)));
  const d = mk4(); d.t.goto(1e9); const lastIdx = d.h.st.idx;
  ok("★ 拖到超界 ⇒ 停在末帧，且末帧视图仍然算得出来（拖动不许把播放器拖死）", lastIdx === p.frameCount - 1 && !!p.view(lastIdx), lastIdx + "/" + p.frameCount);
}

sec("[8] 组件接线（防止逻辑被抄回 <script setup> —— 那是两处真相）");
{
  const vue = S("components/theater/BattleTheater.vue");
  const code = vue.split("\n").filter((l: string) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
  ok("★★★ 组件真的用了 transport（import + createTransport）", /from "\.\.\/\.\.\/theater\/transport\.ts"/.test(code) && /createTransport\(/.test(code));
  ok("★★★ 关键时刻集合不再写在组件里（只许有一份）", !/new Set\(\[\s*"SKILL_CAST"/.test(code));
  ok("★★★ 倍速档位不再写在组件里（模板 v-for SPEEDS）", !/\[0\.5,\s*1,\s*2,\s*4\]/.test(code) && /v-for="s in SPEEDS"/.test(code));
  ok("★★ 控制条仍然把计时器交给组件（模块不碰 setInterval —— 它是纯的）", /setInterval\(/.test(code) && /frameIntervalMs\(/.test(code));
  ok("★★★ 计时器跟着 playing 走（transport 自己停时必须清掉计时器，否则「暂停了帧号还在动」）", /watch\(playing/.test(code) && /clearInterval\(timer\)/.test(code));
  ok("★★ transport.ts 里没有 Vue / DOM（纯模块才能被这样断言）", !/from "vue"|document|window\./.test(S("theater/transport.ts")));
}

console.log("\n=== Theater 播放控制（transport）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
