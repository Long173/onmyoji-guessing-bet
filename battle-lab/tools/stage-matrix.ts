// tools/stage-matrix.ts — ★★★ G0–G7 的**可执行验收矩阵**（第 81 轮，目标 ⑫）
//
// 由来：报告 §2 里那张「八个阶段」表是**手写**的。第 81 轮去核对时发现它已经烂了：
//   g1 写 41/41（实测 42）、g2 写 20/20（实测 29）、ui8 写 37/37（实测 40）、
//   ui10 写 28/28（实测 53）、g5 写 29/29（实测 34）。
//   —— 与项目里反复出现的"表比事实乐观/落后"完全同类，只是这次烂的是**验收表本身**。
//
// 所以把它机械化：阶段 → 测试文件写成**声明**，数字**跑出来**而不是抄进来。
//   node tools/stage-matrix.ts          跑全部映射并打印矩阵（有缺失/失败/报告过期则退出非 0）
//   node tools/stage-matrix.ts --json   只输出 JSON（供文档生成）
//   node tools/stage-matrix.ts --write  把报告 §2 的表**重新生成**（marker 之间，勿手改）
//
// ★ 第 92 轮补的第二个洞：§2 那段写着「数字由运行产生」，但**数字本身还是手抄的**，
//   于是它又烂了一次 —— g42 写 41（实测 51）、合计写 402（实测 412）。
//   「表比事实乐观」在项目里已经是第四次。所以这次不只给工具：把表格放进 marker，
//   默认启动**比对**报告里的表与本次实跑结果，不一致就退出非 0（跑 --write 刷新）。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ENGINE = path.join(ROOT, "battle-lab");
const WEB = path.join(ROOT, "apps", "web");

export interface StageTest { suite: "engine" | "web"; file: string }
export interface Stage {
  id: string;
  require: string;
  tests: StageTest[];
  /** 为什么这个阶段今天做不完（做完的留空） */
  blockedBy?: string;
}

/**
 * ★ 每个 G 阶段至少一个**可执行**验收测试。这张表是声明，数字由运行产生。
 * ★ G6/G7 的 blockedBy 不是借口，而是一条事实：它们需要**游戏内观测**，
 *   而观测只能来自游戏。仪器已经就绪 —— 能交付的是仪器，不是观测。
 */
export const STAGES: Stage[] = [
  { id: "G0", require: "BattleState 收口：所有运行状态可序列化，暂停→存档→重启→续跑一致",
    tests: [
      { suite: "engine", file: "tests/g0-state.ts" },
      { suite: "engine", file: "tests/g53-startup-stages.ts" },
      // ★★★ 第 190 轮补：a1-4 §55 的字面要求是「**杀掉 Engine** → 重新加载」——
      //   g0-state 验的是同一进程内丢弃实例重建，挡不住「依赖进程状态」的 bug。
      //   g112 把同一件事放到**子进程**里做（存档只能是一份 JSON、恢复只能靠知识库），
      //   当场照出 StatusBook 这个模块级单例在冷进程里取不到状态定义（指纹漂到 a85410dcc35735ea）。
      { suite: "engine", file: "tests/g112-cross-process-state.ts" },
      // ★★★ 第 190 轮补：**开局只能跑一次**（runStartup 幂等）—— 恢复出来的战斗 startupDone 已是 true，
      //   任何一次多余的 runStartup() 都会把开局重放一遍（先机再触发一次）。
      { suite: "engine", file: "tests/g16-startup-once.ts" },
    ] },
  { id: "G1", require: "Event Queue 标准化：skill/passive/soul/status 不再递归直接互调",
    tests: [{ suite: "engine", file: "tests/g1-event-queue.ts" }, { suite: "engine", file: "tests/g75-event-coverage.ts" }, { suite: "engine", file: "tests/g76-event-wiring.ts" }, { suite: "engine", file: "tests/g78-passive-status-trigger.ts" }] },
  { id: "G2", require: "Snapshot + Delta + Checkpoint：任意时刻可重建 BattleState",
    tests: [{ suite: "engine", file: "tests/g2-snapshot.ts" }, { suite: "engine", file: "tests/g74-delta-economy.ts" }] },
  { id: "G3", require: "Full Replay：CLI 逐帧回放，Frame N state == Engine final state",
    tests: [
      { suite: "engine", file: "tests/g3-replay.ts" },
      // ★★★ 第 191 轮补：**CLI 那一条路径的验收测试**（g73 一直在跑，却没进矩阵）。
      //   同轮把「Frame N state == Engine state」从**终局那一帧**扩到**每一帧**：
      //   记录器逐帧存引擎状态指纹（frameHashes），verify 于是能逐帧比对，
      //   并且 CLAUDE 打印的那句话必须与真正验过的项逐字对应（此前是「全部帧可重建」，实际只抽查 4 帧）。
      { suite: "engine", file: "tests/g73-replay-cli.ts" },
    ] },
  { id: "G4", require: "Battle Theater：从开局播到胜负（Entity Card / Action Bar / 鬼火 / 死亡状态机）",
    tests: [
      { suite: "web", file: "tests/ui8-theater.ts" },
      // ★ 第 137 轮补：审核发现「播放/暂停/单步/倍速/拖动」在验收层面是空的（逻辑长在 <script setup> 里，
      //   本仓库又没有 jsdom/@vue/test-utils）。处置是把逻辑搬进 theatre/transport.ts + 合成录像
      //   把 Presenter 的规则钉死 —— 这两条就是那两件事的验收测试。
      { suite: "web", file: "tests/ui14-transport.ts" },
      { suite: "web", file: "tests/ui15-presenter-synth.ts" },
      // ★ 第 138 轮补：**组件层运行时验收**（vue/server-renderer，不需要 jsdom）——
      //   卡面记数串、编译徽章四档、面板逐技能一节的真实渲染。
      { suite: "web", file: "tests/ui16-ssr-render.ts" },
      // ★ 第 139 轮补：**Theater 与 Entity Card 的真实渲染**（10 张卡 / 行动条 / 鬼火 / 控制条 /
      //   五态 / Hover / CSS 变量闭环）—— §12-§19 那批「画面上必须看得见」的验收。
      { suite: "web", file: "tests/ui17-visual-render.ts" },
    ] },
  { id: "G5", require: "Inspectors：Damage Breakdown / AI 决策 / Buff / RNG / Event Parent-Root",
    tests: [{ suite: "engine", file: "tests/g5-inspectors.ts" }, { suite: "web", file: "tests/ui9-inspectors.ts" }] },
  { id: "G6", require: "Fidelity 五层 + 与真实游戏对照定位第一处分歧",
    tests: [{ suite: "web", file: "tests/ui10-fidelity.ts" }, { suite: "engine", file: "tests/g19-first-divergence.ts" }],
    blockedBy: "需要游戏内观测：仪器（Replay / Inspector / Fidelity / 观测登记 / diff）已就绪，观测只能来自游戏" },
  { id: "G7", require: "M2 实测：UNKNOWN → VERIFIED",
    tests: [{ suite: "engine", file: "tests/g42-trigger-registry.ts" }, { suite: "web", file: "tests/ui10-fidelity.ts" }],
    blockedBy: "需要游戏内长期观测：本轮交付的是观测登记入口与判定门槛" },
];

/** 跑一个测试文件，返回它自报的通过条数（解析不出返回 -1） */
export function runTest(t: StageTest): { n: number; ok: boolean; file: string } {
  const cwd = t.suite === "engine" ? ENGINE : WEB;
  const full = path.join(cwd, t.file);
  if (!fs.existsSync(full)) return { n: -1, ok: false, file: t.file };
  try {
    const out = execFileSync(process.execPath, [t.file], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const m = out.match(/(\d+)\s*(?:passed|通过)/);
    return { n: m ? Number(m[1]) : -1, ok: true, file: t.file };
  } catch { return { n: -1, ok: false, file: t.file }; }
}

// ── 报告 §2 的表：生成 + 比对（第 92 轮）──────────────────────────────────
// 上一轮把「阶段→测试」机械化成了声明，但**报告里那几个数字仍然是手抄的**，
// 于是它照样烂：g42 写 41（实测 51）、合计写 402（实测 412）。同一类 bug 第四次。
// 这次把表关进 marker：--write 生成，默认运行**比对**，不一致就退出非 0。
export const MATRIX_BEGIN = "<!-- STAGE-MATRIX:BEGIN 由 node tools/stage-matrix.ts --write 生成，请勿手改 -->";
export const MATRIX_END = "<!-- STAGE-MATRIX:END -->";
export const REPORT = path.join(ROOT, "10-M1.9-全局战斗与真实性体系.md");

export interface MatrixTest { file: string; n: number; ok: boolean }
export interface MatrixRow {
  id: string;
  require: string;
  total: number;
  tests: string[];
  detail: MatrixTest[];
  blockedBy: string | null;
}

/** 由本次实跑结果生成 §2 的表（未完成原因逐字取自声明，一起放进 marker 内） */
export function buildTable(rows: MatrixRow[]): string {
  const sum = rows.reduce((a, r) => a + r.total, 0);
  const blocked = rows.filter(r => r.blockedBy);
  const cell = (r: MatrixRow) => r.detail.map(t =>
    "`" + t.file + "` " + (t.ok && t.n >= 0 ? "**" + t.n + "**" : "★运行失败")).join(" + ")
    + (r.detail.length > 1 ? " = **" + r.total + "**" : "");
  const L: string[] = [];
  L.push(MATRIX_BEGIN);
  L.push("| 阶段 | 要求 | 状态 | 验收（`node tools/stage-matrix.ts` **实时跑出**，不是抄的） |");
  L.push("|---|---|---|---|");
  for (const r of rows) {
    L.push("| **" + r.id + "** | " + r.require + " | " + (r.blockedBy ? "被观测阻塞" : "完成") + " | " + cell(r) + " |");
  }
  L.push("| **合计** | | **已验收 " + (rows.length - blocked.length) + " 个阶段｜被观测阻塞 " + blocked.length + " 个** | **" + sum + " 条** |");
  if (blocked.length) {
    L.push("");
    L.push("> **被观测阻塞的阶段的未完成原因**（逐字取自 `STAGES` 的 `blockedBy`，不是另写一遍）");
    for (const r of blocked) L.push("> - **" + r.id + "**：" + r.blockedBy);
  }
  L.push(MATRIX_END);
  return L.join("\n");
}

/** 报告里的表与本次实跑一致吗？三种不一致要分得开（找不到 / 重复 / 过期） */
export function compareTable(reportText: string, table: string):
  { ok: true } | { ok: false; code: "NO_MARKER" | "DUP_MARKER" | "STALE"; detail: string } {
  const nb = reportText.split(MATRIX_BEGIN).length - 1;
  const ne = reportText.split(MATRIX_END).length - 1;
  if (nb === 0 || ne === 0) return { ok: false, code: "NO_MARKER", detail: "报告里找不到 marker（BEGIN " + nb + " / END " + ne + "）" };
  if (nb > 1 || ne > 1) return { ok: false, code: "DUP_MARKER", detail: "marker 出现多次（BEGIN " + nb + " / END " + ne + "），改哪一处说不清" };
  const cur = reportText.slice(reportText.indexOf(MATRIX_BEGIN), reportText.indexOf(MATRIX_END) + MATRIX_END.length);
  if (cur.trim() !== table.trim()) return { ok: false, code: "STALE", detail: "报告 §2 的表与本次实跑结果不一致" };
  return { ok: true };
}

function runAll(): { rows: MatrixRow[]; bad: number } {
  const rows: MatrixRow[] = [];
  let bad = 0;
  for (const s of STAGES) {
    const results = s.tests.map(runTest);
    const total = results.reduce((a, r) => a + Math.max(0, r.n), 0);
    bad += results.filter(r => !r.ok || r.n < 0).length;
    rows.push({
      id: s.id, require: s.require, total,
      tests: results.map(r => r.file + " " + (r.ok ? r.n + " 条" : "★运行失败")),
      detail: results.map(r => ({ file: r.file, n: r.n, ok: r.ok })),
      blockedBy: s.blockedBy ?? null,
    });
  }
  return { rows, bad };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const { rows, bad } = runAll();
  const table = buildTable(rows);
  const report = fs.readFileSync(REPORT, "utf8");
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 1));
  else {
    console.log("=== G0–G7 可执行验收矩阵（数字由运行产生）===");
    for (const r of rows) {
      console.log("\n" + r.id + "  " + r.require);
      r.tests.forEach((t: string) => console.log("     " + t));
      console.log("     合计 " + r.total + " 条" + (r.blockedBy ? "\n     ★ 未完成原因：" + r.blockedBy : ""));
    }
    const sum = rows.reduce((a, r) => a + r.total, 0);
    console.log("\n矩阵合计 " + sum + " 条｜" + (bad ? "★ 有 " + bad + " 个文件缺失或失败" : "全部通过"));
    const dirs = [path.join(ENGINE, "tests"), path.join(WEB, "tests")];
    const all = dirs.flatMap(d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".ts")) : []);
    const mapped = new Set(STAGES.flatMap(s => s.tests.map(t => String(t.file.split("/").pop()))));
    console.log("映射测试文件 " + mapped.size + " 个｜仓库内测试文件 " + all.length + " 个｜未映射 " + (all.length - mapped.size) + " 个（本表只主张 G 阶段验收，不主张覆盖全部测试）");
  /**
   * ★★★ 第 149 轮：**已知缺口**随矩阵一起打印。
   *   由来：缺口此前只散落在报告各轮的「还没做的」小节里 —— 想知道"还剩什么"要翻十几节。
   *   这里给一份**唯一清单**（与本表同一屏），每条都标了它卡在哪一类：
   *     · REPO   = 仓库内可继续做（有判据、有落点）
   *     · SPEC   = 需要先定规格口径（不该由实现来猜）
   *     · EXTERN = 需要外部输入（游戏内观测）
   *   ★ 它**不进**报告 §2 的表（那张表由 marker 管、只放数字），所以不影响 §2 的比对。
   */
  const KNOWN_GAPS: Array<{ what: string; kind: "REPO" | "SPEC" | "EXTERN"; note: string }> = [
    { what: "技能替换：引擎层 + **32 条缺形态技能的数据**", kind: "REPO",
      note: "★★★ 第 182 轮把 33 条逐条问了一遍（tests/g104-skill-swap-plan.ts，6 条）：**目标技能能在同角色技能表里解析到的只有 1 条**（待宵姑获鸟「墨风」→『[skill_354_03]』墨影剑光）；其余 **32 条的目标是形态 / 姿态专用技能，KB 里根本没有**（『追魂』『挚友之怒』『跟我学』『鬼之爪』『八岐之影』『终舞』「春告」…）⇒ 这一条的主体是**数据缺口**，不是引擎缺口：引擎层（可换的技能表 + 计数器 / 事件触发）做出来在当前知识库下**只能解锁 1 条**，而且那 1 条还额外需要计数器（「每3次普攻后」）。★ 记账口径据此改写（原来写的是「需要技能表可换这一层」，读起来像「引擎做出来就解锁 33 条」）。判据与行为面钉子另见 tests/g88-skill-swap.ts" },
    { what: "伤害 / 治疗的**基数**要不要改（会动默认档指纹）", kind: "SPEC",
      note: "★★★ 第 183–184 轮量出来两族：① **伤害** —— 10 个技能的子句写「造成（自身 / 敌方）生命上限N%」，而产物一律 base=atk（数值能差一个数量级：攻击 5000 对生命 30000）；② **治疗** —— 11 个技能的治疗产物一律 base=maxHp，而子句写的是「治疗**攻击**N%」（10 条）或「治疗**等同该次伤害**N%」（2 条动态量，引擎表达不了）。两族都**只记账**（damageBaseMismatch / healBaseMismatch；尺子 tests/g106-base-mismatch.ts 11 条）。★ 为什么不动手：改基数会动到**典型对局**的默认档指纹 2d7c7507e18db61f（阵容里有 聆海金鱼姬 346 —— 它的「灵鱼抱蕊」写的正是「治疗攻击50%的生命」；伤害那族涉及 樱花妖 267）。这与 §142 是同一类决定：要么接受一次基线变更（重记指纹 + 在 compile-explain.json 里逐条解释变化），要么保持现状只记账。命中名单：伤害 242/242_02 · 253/253_03 · 267/267_03 · 272/272_02 · 324/324_02 · 332/332_01 · 570/570_03 · 591/591_02 · 595/595_03 · 604/604_03；治疗 238/238_02 · 238/238_03 · 247/247_02 · 306/306_02 · 346/346_03 · 363/363_03 · 397/397_02 · 555/555_03 · 576/576_01 · 588/588_02 · 600/600_03。★★ 第 186 轮又把**名字形态的状态引用**并进同一个决定：大天狗 217/217_03「增加1层雄姿英发」（→2173_1）与 聆海金鱼姬 346/346_03「施加3层结怨」（→3461_1）两个效果**整个漏收**（正文写名字、编译器只认方括号），产物已落（statusRefNameForm），**接进 statusRefs 就会改变行为** —— 而 346 正在典型阵容里。三条一起拍即可（都是「要不要接受一次基线变更」）" },
    { what: "**技能等级**的口径（「假定满级」还是「用基础值」）", kind: "SPEC",
      note: "★★★ 第 256 轮量出来的（报告 §197.7，探针 tools/_probe-level256.ts）：仓库里 `SkillIR.levelScale` 写着「竞猜口径假定满级，所以未读取」，**但产物用的是基础值** —— 771 条技能有升级表，其中 **368 条**（伤害 358 · 治疗 10）的满级数值与产物不同（回春舞 100% vs 125%、桃花妖「花之馨息」30% vs 25%）。两句话只能留一句：① 承认口径是「满级」⇒ 按升级表改产物（会动两个典型指纹，需要一次基线变更 + 逐条解释）；② 承认用的是基础值 ⇒ 把 allowlist 与报告里的措辞改对（不动行为）。★ 与「伤害/治疗基数」是同一类决定（都要动基线），所以并列等你拍。" },
    { what: "**逐句效果归因**：四族效果已接上，剩下两块", kind: "REPO",
      note: "触发是逐句的，效果的施加却是技能级的 ⇒ 触发第一句会把同一门技能里别的子句的效果也一起放出去（多算）。★ 第 180–181 轮接上**状态引用**那一半：产物 statusRefClauses 细到**槽位**（112 个技能）+ statusRefConditionOnly（只当条件的槽位）；执行侧 statusRefSlotsForClause 按**槽位下标**收窄（没有证据 ⇒ 照旧全放）；端到端实测：九命猫暴击触发 2072_1 **只 +1**（此前 +2）。尺子 tests/g103-status-attribution.ts（14 条）。★★★ 第 188 轮接上**第二批**（damage / heal / shield / timeline）：产物 effectClauses（正则匹配下标 → 小句区间，**不是**按数字回找子句）+ 执行侧 onlyEffectSlots；46 个被动带证据，全库实测 27 条装上的触发句里 **16 条**会因此改变行为、方向**全部是去掉多算**（闻人翊悬「火浣重重」：一次「造成伤害」白送 20%+100% 行动条 → 0 次，而状态那一段一层不少）；两个指纹（默认档 2d7c7507e18db61f / 被动档 6d7fb675c3d14eaf）逐位不变。尺子 tests/g110-effect-attribution.ts（36 条）。★ 同一轮顺带收掉**第三种假阳性伤害**：dmgGeneric 的尾巴把「有25%[tips_2]附加…」的**概率**当成了伤害（292「霜天之织」/304「一矢」，damageSkips 新增 PROBABILITY_NOT_DAMAGE；匹配级判据，不许按 ratio 拉黑）。★★★ 第 193 轮把最后那块**条件写法**做完了（见报告 §165）：产出侧认**两种读法** ——① 条件写法「若…[buff_x]」（引用在条件词之后、中间没有施加类动词；**被动词不算施加**）；② 计数写法「每(有|获得|消耗)?N层[buff_x]」（按层缩放/门槛，不是给几层）。命中 **39 个技能**（条件 17 + 计数 17，有重叠），执行侧**两条路径都装了闸门**（此前只装在被动路径上 ⇒ 以津真天「风之舞」施放一次白送 2 层 2862_1）。两个指纹仍逐位不变。尺子 tests/g103-status-attribution.ts（41 条：判据双向 19 例 + 行为双向）。★ **剩下最后一块**：**名字形态**的状态引用 —— 言灵「和音」写「增加1层**墨灵**」而不是 [buff_3991_1]，编译器只认方括号形态（产物已落 statusRefNameForm，接进 statusRefs 会改行为 ⇒ 与基数那一条同属待裁定）" },
    { what: "触发句的**主语**模型：条件表达不了的限定语（11 条）", kind: "REPO",
      note: "★★★ 第 178 轮勘定：全库 **29 条**子句的**触发主语不是拥有者**，而族表里只有 SELF / TARGET 两种 side。第 179 轮接上**第一批**（锚在句首：敌方 / 友方 / 任意，见报告 §151）；★★★ 第 189 轮接上**第二批**（见报告 §161）：① **带限定语的主语**（「带有[buff_2163_1]的敌方阵亡时」）—— 只在**实测词头表**（84 种词头，取自 tools/_probe-subject189b.ts）上放宽锚点，主语之前不许有逗号；② **友方（ALLY⇒TEAM）** 与**排除自己**（「其他友方 / 除自身 / 非自身的 / 自身外」—— KB 自己就用这些写法表示不含自身，不是猜的）；③ 目标侧族的过滤条件由主语决定（此前写死「目标就是自己」⇒ 虫师「虫之痕」方向正好反了）；④ **限定语里的条件必须能表达**：出现条件词却拿不到 [buff_x] ⇒ 整条不收（fail-closed + 记账）。全库落点：3886 条子句里主语非自己 124 条（排除自己 11｜带状态条件 5）· **认出来但没收 11 条**（弈「带有棋子的敌方」· 匣中少女「被记录的友方」· 黑崎一护「生命比例低于40%的非自身的友方」…）· 装机面 82 条里 5 条主语非自己（巫蛊师 / 青行灯 / 虫师 / 言灵 / 言和），本轮真的改变了行为的正是前三条。尺子 tests/g111-subject-qualified.ts（45 条，含三条行为面双向 + 指纹）。★ 同一轮顺带收掉**第二处算错**：同一个「有N%概率」被触发侧与效果侧**各掷一次**（实际概率是 p 的平方）—— 8 条装上的触发句命中，青行灯「明灯」400 次只有 7 次（≈1.75%）⇒ 修好后 400 次进处理器、命中 49 次。★ **剩下一条**：限定语里的条件**表达不了**的那 11 条（随机增益/减益、被占位、生命比例门槛、名字形态的状态）。★★ 第 190 轮把这 11 条逐条问了一遍（tools/_probe-limiter190.ts）：**它们今天一条都装不上**，而且**不是主语层挡着** —— 8 条根本没有触发族（鬼使白 / 蝴蝶精 / 匣中少女 / 卖药郎 / 虫师 / 久次良 / 黑崎一护 / 神乐&定春），2 条被下游挡着（阎魔 255_02 挡=EFFECT 召唤物、弈 303_02 挡=CONDITION「若该回合没消耗鬼火」），1 条是主动技能。⇒ 这一条的主体**不是主语模型**，是那些条件/效果模型本身（与「随机增益/减益」「召唤物」那两条缺口重合）；主语层做到这里为止。另有个别技能主语认出来了、但**效果本身没建模**（百目鬼「鬼眸」的计数器）。尺子：tests/g101-subject-plan.ts（13 条）" },
    { what: "「来源承受者」剩下的**两条**（触发状态 / 未建模的占位符效果）", kind: "REPO",
      note: "① 匣中少女「溢彩」287_02 的**随机减益那一半第 194 轮已接线**（池子从 tips_200/201 读出来：产物 randomStatuses + 执行侧池子循环；尺子 tests/g114-random-pool.ts 53 条）——**剩下的**是同一句里「同时获得1个随机增益」那半：它属于「友方行动前」，而触发族登记册里**根本没有这一族**（matchFamily 返回 null），所以两条产物都解析出来了、只有减益那一半会真的发生（g114 第 [6] 节钉住）。② 狸猫「醉倒」208_02「醉倒时…」—— 触发状态本身没建模。③ 第 194 轮量出来的那一族（`%[tips_2]` 后面跟**控制类占位符**）**第 195 轮已接线**：45 条控制引用真的会施加（尺子 tests/g115-control-tips.ts 34 条；挡下数第 242 轮 34 → 32、第 246 轮 32 → 31），映射只有一份（kernel/status.ts 的 controlDefByTipName）。余下 31 处**全部是按理由码挡下的**，其中**真正还没做的只剩 4 处**：分支 **1**（雪女「则改为冰冻2回合」）+ 随机取一 3。★ 分支那 1 条是**领域边界、不是待办** —— 对弈竞猜是 PvP，「若目标为怪物」这一支**永不成立**（与 §104「偷鬼火：全库 0 条」同一种记账口径：引擎保留 skip、不假装实现，但不该挂在待办上）；★ 随机取一 3 条是**选项异构**（镰鼬那三选一里只有眩晕是控制状态；稻荷神那四条里「封印/压制」不在 CONTROL_EFFECTS(17) 里 ⇒ 只挑控制那一个来施加会把 1/3 变成 1/1，fail-closed 挡下才是对的）；★★★ 已落地的两批：第 242 轮**效果位条件变体**（雪女 201_03「转化为深度冰冻」· 雪童子 292_02「转为深度冰冻」——`controlRefs[].variant`，条件不掷骰、概率掷一次、命中**改写**该效果位；尺子 tests/g121-control-variant.ts 19 条）与第 246 轮**「失去 X 时结束 Y」**（蝉冰雪女「永冬」362_03——`SkillIR.endOnLose` + kernel/end-on-lose.ts；尺子 tests/g124-end-on-lose.ts 16 条）；其余为引用式 10（「被冰冻的目标时」「对眩晕的敌方必定暴击」）· 否定式 10（「免疫混乱」「驱散其带有的冰冻」——第 196 轮起兔丸那条已按名驱散接线）· 无施加动词 6（规则说明句）· 场地已在做 1（神酿星熊童子，场地 perTurn 已在施加）。" },
    { what: "追加施放：剩下的三条触发形状（3 条，全部数据阻塞）", kind: "REPO",
      note: "已接线两半：**触发式**（第 135 轮，「…并对随机敌方目标施放『X』」走伪回合）与**先机式名字引用**（第 164–172 轮接线、第 174 轮在报表层放行 —— 见报告 §146）。★★★ 第 239 轮把其中的 ① 落地了：**百目鬼「鬼眸」293_02**（报告 §177–§179）—— `free` 通路（第 237 轮）+ 合成状态 `GHOST_EYE`（第 238 轮）+ `SkillIR.counterCast`（第 239 轮）三件齐了：AFTER_DAMAGE 处理器只认**敌方 + 暴击**、40% 只在触发侧掷一次、满 5 层走**免消耗**施放、放后清零；尺子 tests/g118-counter-cast.ts（29 条）+ tests/g117-ghost-eye.ts（15 条）。记账同步撤回（**有执行点的施放子句不再报缺口**）：全库报「追加施放」的技能 **6 → 5** 条。剩下 **3 条全部数据阻塞**：御馔津「一矢」5% 概率触发 · 麓铭大岳丸「逆魂尽断」自身回合自动施放 · 梦寻山兔「兔忍舞！！」条件触发 —— 它们的**目标技能不在 KB 里**（第 195 轮实测），没有数据就没有判据。" },
    { what: "条件伤害分支（2 条：御怨般若「恨返」331_01 ·「予愿必还」331_03）", kind: "REPO",
      note: "★★★ 第 250 轮实测（tools/_probe-dd250.ts）：这两条此前 confidence=HIGH / unparsed 空 / 无未建模 —— 也就是报表说「完整编译」—— 而伤害形状与原文不符：331_01 一次施放打出 **4 条**伤害事件（原文 1 条，开结界 2 条）、331_03 打出 **15 条**（原文 8 或 13 条）。原因：编译器把「若开启X，则此技能改为…」的两条分支伤害**都**收进了 damage[]，运行时两条都打。★ 第 250 轮**只记账、不改行为**（句子判 MECHANIC_UNPARSED + 缺口动词「条件伤害分支」/ WARN，clause 可复核、evidence 指向实测）；★★★ **第 251 轮**修掉了 331_01 的**多算**（分支槽摘进 damageBranch、基础形态 hits 收回 1 ⇒ 4 条 → **1 条**，报告 §191）；★★★ **第 252 轮**修掉了 331_03 的**形状**（damageSegments：3 次单体 + 1 次全体 ⇒ 15 条 → **8 条**，报告 §192）。尺子 tests/g128-damage-branch.ts（18 条）与 tests/g129-damage-segments.ts（46 条）。★ 仍未执行的那一半：条件本身（「封印结界」在引擎里没有载体）—— 记账照旧保留。" },
    { what: "分段伤害形状（12 条族：**已修 6 条** · 记账其余）", kind: "REPO",
      note: "★★★ 第 252 轮（报告 §192）：探针 tools/_probe-seg252.ts 量出全库 `hits>1` 且 `targeting` 同时含「全体」与「单目标」的技能 **12 条** —— 执行侧的展开式只有「槽数 × hits × 受击人数」，于是次数被同时套到单体段与全体段上（实测 262_03 **30** 条 / 281_03 **50** 条 / 331_03 **15** 条 / 375_03 **20** 条，原文 16 / 10 / 8 / 11）。第 252 轮把判据干净的 4 条落地（`SkillIR.damageSegments` + 执行侧按段展开）；★★★ **第 254 轮又收下两种写法**（②**反序** 607_03「百羽衔火」1×单体160% + 2×全体50% ⇒ 20 → **11 条** · ③**静态追加** 556_03「神圣裁决」3×全体72% + 3×单体72% ⇒ 15 → **18 条**），尺子 tests/g129-damage-segments.ts（**60 条**）；其余按两个缺口动词记账：**「分段伤害形状」5 条**（210_03 / 260_03 两段范围相同、392_03 / 399_03 / 592_03 动态量或条件追加）、**「次数读成了上限」6 条**（本族 2 条：217_03「最多触发6次」把 4 次读成 6 次、390_02「触发6次星爆」把触发次数当成施放段数；别族 4 条：286_01 / 385_02 / 500_02 / 572_02）。★ 边界：**390_02 神启荒在典型对局阵容里**，改它会动两个典型指纹 ⇒ 与「伤害基数 / 治疗基数」同一条处置（先记账、等一次明确裁定）。" },
    { what: "**承受者选择规则**：按属性挑人（8 条）", kind: "REPO",
      note: "★★★ 第 254 轮（报告 §194）：全库 9 条写着「使…（初始）攻击/生命最高…的友方/式神获得X」，其中 **8 条此前静默**。引擎的承受者只有 SELF / TARGET 两种 side（第 176–189 轮接的是**触发主语**那一半），不会按属性挑人 ⇒ 这个状态会落到「AI 选的那个人」身上，而不是原文点名的那一个。缺的是「按属性排序挑一个」的 ActorResolver 规则（与 §⑨ 的 ActorResolver 同族）。" },
    { what: "**延迟伤害**没有时间线（已记账 1 条：判官「死亡宣告」251_03）", kind: "REPO",
      note: "★★★ 第 253 轮（报告 §193）：251_03 的「未被移除时，在目标回合开始前造成攻击100%[tips_5]」是**延迟 + 有条件**的那一次伤害，而引擎的触发引擎只做「事件 → 立即执行」—— 没有「在某个未来时点造成一次伤害」的调度。本轮把类型判定收口之后，同一比例的即时/延迟两条槽不再互相去重，于是这条**必须**被处理：合并闸门保留**即时**那一条，把延迟那一半原样记进 `SkillIR.damageTypeCollisions`（候选：给触发引擎加一个「定时器」队列，与 a1-4 §G1 的 LifecycleQueue 同族）。★ 同族的「引爆」写法（「消耗所有层数，每层造成…」）今天也是在施放瞬间一次打完 —— 那是**同一个缺口的另一面**，值得与它一起做。" },
    { what: "蝉冰雪女「息吹」凝结形态", kind: "REPO", note: "卡在 KB 数据缺口（形态本身没有权威数据）" },
    { what: "G6 的第一处分歧（与真实游戏对照）", kind: "EXTERN", note: "仪器与登记入口都在（tools/fidelity-cli.ts report|diff、apps/web/src/lab/observations.ts），缺游戏内观测数据" },
  ];
  const KIND_LABEL: Record<string, string> = { REPO: "仓库内可做", SPEC: "待定规格", EXTERN: "需外部输入" };
  console.log("\n=== 已知缺口（唯一清单；分类见括号）===");
  for (const g of KNOWN_GAPS) console.log("  [" + KIND_LABEL[g.kind] + "] " + g.what + "\n      " + g.note);
  console.log("  合计 " + KNOWN_GAPS.length + " 条：仓库内 " + KNOWN_GAPS.filter(g => g.kind === "REPO").length
    + "｜待定规格 " + KNOWN_GAPS.filter(g => g.kind === "SPEC").length
    + "｜需外部输入 " + KNOWN_GAPS.filter(g => g.kind === "EXTERN").length);
  }
  let badTotal = bad;
  if (process.argv.includes("--write")) {
    const c = compareTable(report, table);
    if (c.ok) console.log("\n报告 §2 的表已是最新，无需改动。");
    else if (c.code === "STALE") {
      const merged = report.slice(0, report.indexOf(MATRIX_BEGIN)) + table + report.slice(report.indexOf(MATRIX_END) + MATRIX_END.length);
      fs.writeFileSync(REPORT, merged, "utf8");
      console.log("\n★ 报告 §2 的表已重新生成 → " + REPORT);
    } else {
      console.log("\n★★ " + c.detail + " —— --write 拒绝盲写（找不到或重复的 marker 会让它改错地方）");
      badTotal++;
    }
  } else {
    const c = compareTable(report, table);
    if (c.ok) console.log("报告 §2 的表与本次实跑一致 ✓");
    else {
      console.log("\n★★★ " + c.detail + "（" + c.code + "）");
      if (c.code === "STALE") console.log("  跑 node tools/stage-matrix.ts --write 刷新它。应该长这样：\n");
      console.log(table);
      badTotal++;
    }
  }
  if (badTotal) process.exitCode = 1;
}
