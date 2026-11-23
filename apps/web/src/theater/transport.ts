// theater/transport.ts — ★★★ 第 137 轮：把 Theater 的**播放控制**从组件里搬出来
//
// 由来（第 137 轮审核的结论）：⑥ G4 的 7 项里，**播放/暂停/单步/倍速/拖动**是唯一
// 「验收层面没做」的一项 —— BattleTheater.vue 里有实现（goto/stepBy/nextKeyFrame/nextTurn/play），
// 但 apps/web/tests 全库搜 nextKeyFrame|scrub|stepBy|倍速 一条断言都没有。
// 根因不是「忘了写」，而是**逻辑长在 <script setup> 里**：那个作用域要挂载组件才能进，
// 而本仓库没有 jsdom / @vue/test-utils（package.json 里没有），也不打算为了这类断言
// 把网页端拖成一个需要下载浏览器的工程。
//
// 所以走「分层」这条路（与 Presenter 同一条纪律：**能算的东西不许藏在模板里**）：
//   · 本模块 = 纯逻辑，零 Vue、零 DOM、零计时器 —— 帧号推进、关键时刻扫描、倍速间隔，全在这里；
//   · 组件 = 只做两件事：把 ref 暴露成 host、把 setInterval 挂上。
// 这样「播放控制」就有了可执行断言（tests/ui14-transport.ts），而组件里剩下的那点接线
// 由源码级断言盯着（防止逻辑又被抄回组件里 —— 那是「两处真相」的老毛病）。
//
// ★ 单一来源：关键时刻集合与倍速档位**只在本文件里写一份**，组件 v-for 它。
//   上一版 KEY 集合直接写在组件里，于是「哪些帧算关键时刻」这件事没有任何读者。

/** 「值得看」的帧类型（跳到下一个关键时刻用）。顺序无关，只做成员判断。 */
export const KEY_FRAME_KINDS: readonly string[] = [
  "SKILL_CAST", "DAMAGE", "DEATH", "LETHAL", "REVIVE", "DEATH_PREVENTED", "ORB_REWARD", "TIMELINE_SHIFT", "STATUS_APPLY",
];

/** 控制条上的倍速档位（组件 v-for 它；断言也读它 —— 不许两边各写一份） */
export const SPEEDS: readonly number[] = [0.5, 1, 2, 4];

export const BASE_INTERVAL_MS = 300;
export const MIN_INTERVAL_MS = 25;

/**
 * 倍速 → 每帧间隔（毫秒）。
 * ★ 非法速度（0 / 负数 / NaN / Infinity）一律退回 1×，而不是让 setInterval 拿到 0 或 NaN：
 *   setInterval(fn, 0) 会退化成「尽快跑」，一秒钟能把整场战斗放完（看起来像卡死）；
 *   setInterval(fn, NaN) 在浏览器里按 0 处理，同样。这不是纸面上的担忧 ——
 *   速度一旦被写成 0，界面表现就是「播放键像没反应，但帧号在飞」。
 */
export function frameIntervalMs(speed: number): number {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.max(MIN_INTERVAL_MS, Math.round(BASE_INTERVAL_MS / s));
}

/**
 * 播放器要读写的**那一点状态**。
 * 组件用 ref 实现它（保持 Vue 的响应式），测试用两个普通变量实现它 ——
 * 于是同一份逻辑两条路都能跑，而状态只有**一处**（不是「模块里一份、组件里一份」）。
 */
export interface TransportHost {
  getIdx(): number;
  setIdx(i: number): void;
  getPlaying(): boolean;
  setPlaying(p: boolean): void;
}

export interface TransportDeps {
  host: TransportHost;
  /** 总帧数 */
  frameCount: () => number;
  /** 事件流（每帧一条，t 是事件码） */
  events: () => ReadonlyArray<{ t?: string; turn?: number }>;
  /** 第 i 帧所属回合（Presenter 提供；nextTurn 的判据） */
  turnAt: (i: number) => number;
}

export interface Transport {
  play(): void;
  stop(): void;
  toggle(): void;
  /** 跳到第 i 帧（夹取到 [0, n-1]） */
  goto(i: number): void;
  /** 相对步进（单步）；**单步必须暂停播放** */
  stepBy(n: number): void;
  /** 跳到上/下一个关键时刻；找不到就落到首/末帧 */
  nextKeyFrame(dir: number): void;
  /** 跳到上/下一回合；找不到就落到首/末帧 */
  nextTurn(dir: number): void;
  /** 播放中推进一帧；返回 false 表示已到末尾并**自动停止** */
  tick(): boolean;
  /** 倍速下的间隔（组件把它交给 setInterval） */
  intervalMs(speed: number): number;
}

export function createTransport(deps: TransportDeps): Transport {
  const { host, frameCount, events, turnAt } = deps;
  const last = () => Math.max(0, frameCount() - 1);

  const stop = () => host.setPlaying(false);

  /**
   * ★ 非有限数不得进入 idx。
   *   Math.round(NaN) 是 NaN，而 Math.min(max, NaN) / Math.max(0, NaN) **两边都是 NaN**
   *   —— 夹取完全失效。idx 一旦是 NaN，views[NaN] 是 undefined，界面白屏且**不报错**。
   *   诚实说明：本轮没有实测到 UI 上的触发路径（range 控件的 value 总是数字），
   *   所以这是一条**白防**；写它的理由是代价一行，另一边的代价是静默失效。
   */
  const goto = (i: number) => {
    if (!Number.isFinite(i)) return;
    host.setIdx(Math.max(0, Math.min(last(), Math.round(i))));
  };

  const seekBy = (dir: number, pred: (i: number) => boolean) => {
    stop();
    // ★ dir === 0 会让 i += dir 永远不前进 —— 循环卡死整个页面。
    //   组件今天只会传 ±1，但这是**模块契约**，不该由调用方保证。
    if (!dir) return;
    const n = frameCount();
    for (let i = host.getIdx() + dir; i >= 0 && i < n; i += dir) {
      if (pred(i)) { goto(i); return; }
    }
    goto(dir > 0 ? n - 1 : 0);
  };

  return {
    play() { host.setPlaying(true); },
    stop,
    toggle() { host.setPlaying(!host.getPlaying()); },
    goto,
    stepBy(n) { stop(); goto(host.getIdx() + n); },
    nextKeyFrame(dir) {
      const keys = new Set(KEY_FRAME_KINDS);
      seekBy(dir, (i) => keys.has(String(events()[i]?.t)));
    },
    nextTurn(dir) {
      const t = turnAt(host.getIdx());
      seekBy(dir, (i) => {
        const ft = turnAt(i);
        return dir > 0 ? ft > t : ft < t;
      });
    },
    /**
     * 推进一帧。到末尾时**自动停止**并返回 false ——
     * 返回值的意义是让组件能把 setInterval 清掉（模块不碰计时器，见文件头）。
     */
    tick() {
      if (host.getIdx() >= last()) { stop(); return false; }
      host.setIdx(host.getIdx() + 1);
      return true;
    },
    intervalMs(speed) { return frameIntervalMs(speed); },
  };
}
