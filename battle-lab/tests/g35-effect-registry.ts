// tests/g35-effect-registry.ts — ★★ Effect Registry 的可证伪性（a1-4 §16）
//
// 这个表最容易退化成「一张漂亮的清单」（「声明本身不是实现」，§24）。
// 所以它必须能被机器证伪，而且**三态互斥且穷尽**：
//     WIRED            使用点 ≥ 1
//     PARTIAL + ORPHAN 定义 ≥ 1、使用点 = 0
//     NONE             连定义都找不到（producer 写的就是「缺的那个东西」）
//
// ★★★ 为什么要分「定义 / 使用点」：第 56 轮第一版把 PseudoAction 标成 FULL，
//   依据是 find("runPseudoTurn").length > 0 —— 而那一处正是它自己的定义。
//   g22 早就用 .runPseudoTurn( 调用点证伪过同一件事。只问「这个字符串在不在」
//   等于不问；必须问「它是以什么身份出现的」。
import fs from "node:fs";
import path from "node:path";
import { EFFECT_KINDS } from "../kernel/effects.ts";
import { CAPABILITIES } from "../capability/registry.ts";
import { producerScanFiles, stripComments } from "../tools/field-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const root = path.resolve(import.meta.dirname, "..", "..");

/**
 * 生产代码（剥注释）。用 producerScanFiles 而**不是** prodFilesOf：
 *   后者会把 kernel/effects.ts 自己也算进来 —— 本轮第一次跑就踩到了，
 *   表的 producer 字段匹配到了表自己，11 条 NONE 全被误报成漏报。
 *   「声明本身不是实现」，所以声明文件必须排除（并连同 experiments/ 脚手架）。
 */
const PROD = producerScanFiles(root).map(f => ({ f: path.relative(root, f).split(path.sep).join("/"), s: stripComments(fs.readFileSync(f, "utf8")) }));

/** 把 marker 在每一行的出现分类。顺序有讲究：先排除掉「明显不是调用」的形态。 */
function classify(line: string, marker: string): "IMPORT" | "LITERAL" | "DECL" | "USE" {
  const t = line.trim();
  const i = t.indexOf(marker);
  if (i < 0) return "USE";
  // ① import / 类型再导出：不是调用
  if (/^import\b/.test(t) || /^export\s+(type\s+)?\{/.test(t)) return "IMPORT";
  // ② 字符串字面量：展示标签、事件名、switch case —— 记的是「发生过什么」，不是「执行什么」
  if (t[i - 1] === '"' || t[i - 1] === "'") return "LITERAL";
  // ③ 定义：marker 前面只有修饰符/关键字，且 marker 的参数表之后跟着 {
  const before = t.slice(0, i);
  const onlyModifiers = /^(export\s+)?(default\s+)?(declare\s+)?(async\s+)?(static\s+)?(readonly\s+)?(get\s+|set\s+)?(function\s+)?$/.test(before);
  if (onlyModifiers && /\)\s*(:\s*[^{=]+)?\{/.test(t.slice(i + marker.length))) return "DECL";
  // ④ 类型/接口声明行
  if (/^(type|interface|enum)\b/.test(t)) return "DECL";
  return "USE";
}

/** marker 在生产代码里的三类命中：{ use: [...], decl: [...], literal: [...], import: [...] } */
function scan(marker: string) {
  const use: string[] = [], decl: string[] = [], literal: string[] = [], imp: string[] = [];
  for (const f of PROD) {
    f.s.split("\n").forEach((L, i) => {
      if (!L.includes(marker)) return;
      const at = f.f + ":" + (i + 1);
      const k = classify(L, marker);
      if (k === "USE") use.push(at + "  " + L.trim().slice(0, 90));
      else if (k === "DECL") decl.push(at);
      else if (k === "LITERAL") literal.push(at);
      else imp.push(at);
    });
  }
  return { use, decl, literal, imp };
}
const find = (marker: string) => { const s = scan(marker); return [...s.use, ...s.decl, ...s.literal, ...s.imp]; };

sec("[1] 表本身");
{
  ok("★ 条目数", EFFECT_KINDS.length === 28, String(EFFECT_KINDS.length));
  const keys = EFFECT_KINDS.map(e => e.key);
  ok("★ key 不重复", new Set(keys).size === keys.length, JSON.stringify(keys.filter((k, i) => keys.indexOf(k) !== i)));
  ok("★★ 每条都写了说明（空说明等于没说）", EFFECT_KINDS.every(e => e.note.trim().length >= 8),
    JSON.stringify(EFFECT_KINDS.filter(e => e.note.trim().length < 8).map(e => e.key)));
  ok("★ support / reach 取值合法", EFFECT_KINDS.every(e => ["FULL", "PARTIAL", "NONE"].includes(e.support) && ["WIRED", "ORPHAN"].includes(e.reach)));
  const bad = EFFECT_KINDS.filter(e => e.support === "FULL" && e.reach === "ORPHAN").map(e => e.key);
  ok("★★ 不存在『FULL 但没人调用』这种自相矛盾", bad.length === 0, JSON.stringify(bad));
  const bad2 = EFFECT_KINDS.filter(e => e.support === "NONE" && e.reach === "WIRED").map(e => e.key);
  ok("★★ 也不存在『标着没实现、却有人调用』", bad2.length === 0, JSON.stringify(bad2));
}

sec("[2] ★★ 覆盖 a1-4 §16 的清单（一个都不能少）");
{
  const spec = ["Damage", "HP Loss", "Heal", "Recover", "Shield", "AddStatus", "RemoveStatus", "Dispel", "Control",
    "TimelinePush", "TimelinePull", "SpeedModify", "ResourceGain", "ResourceCost", "ResourceSteal", "Summon",
    "Revive", "Transform", "ExtraTurn", "PseudoAction", "InviteAttack", "CoAttack", "Isolate", "Link", "Restore",
    "Switch", "Dodge", "Protect"];
  const have = new Set(EFFECT_KINDS.map(e => e.key));
  const missing = spec.filter(k => !have.has(k));
  ok("★★ 规格 §16 列的 " + spec.length + " 条全部在表里", missing.length === 0, JSON.stringify(missing));
  const extra = EFFECT_KINDS.map(e => e.key).filter(k => !spec.includes(k));
  ok("★ 也没有自造条目（表与规格一一对应）", extra.length === 0, JSON.stringify(extra));
}

sec("[3] ★★★ 三态判定：WIRED ⇒ 有使用点｜PARTIAL+ORPHAN ⇒ 只有定义｜NONE ⇒ 连定义都没有");
{
  const cWired: string[] = [], cOrphan: string[] = [], cNone: string[] = [];
  for (const e of EFFECT_KINDS) {
    const s = scan(e.producer);
    if (e.reach === "WIRED") {
      if (s.use.length === 0) cWired.push(e.key + " → " + e.producer + " (定义 " + s.decl.length + "｜字面量 " + s.literal.length + "｜import " + s.imp.length + "，就是没有调用)");
    } else if (e.support === "PARTIAL") {
      if (s.decl.length === 0 && s.literal.length === 0) cOrphan.push(e.key + " → " + e.producer + " (连入口定义都没有)");
      if (s.use.length > 0) cOrphan.push(e.key + " → " + e.producer + " 其实有人调用：" + s.use[0]);
    } else {
      if (s.use.length || s.decl.length || s.literal.length || s.imp.length) cNone.push(e.key + " → " + e.producer + " 竟然找得到 " + find(e.producer).length + " 处");
    }
  }
  ok("★★★ 每条 WIRED 都能找到一个**使用点**（不是定义、不是标签）", cWired.length === 0, JSON.stringify(cWired));
  ok("★★★ 每条 PARTIAL+ORPHAN 都是「入口在、没人调用」", cOrphan.length === 0, JSON.stringify(cOrphan));
  ok("★★★ 每条 NONE 都真的找不到任何痕迹", cNone.length === 0, JSON.stringify(cNone));
  const w = EFFECT_KINDS.filter(e => e.reach === "WIRED").length;
  console.log("    接到生产路径 " + w + " / " + EFFECT_KINDS.length + " 条；入口在、没人调用 " +
    EFFECT_KINDS.filter(e => e.reach === "ORPHAN" && e.support === "PARTIAL").length + " 条；连入口都没有 " +
    EFFECT_KINDS.filter(e => e.support === "NONE").length + " 条");
}

sec("[4] ★★★ 反向：声明**未实现**的，必须真的找不到 —— 否则是漏报");
{
  const bad: string[] = [];
  for (const e of EFFECT_KINDS.filter(x => x.support === "NONE")) {
    const hits = find(e.producer);
    if (hits.length) bad.push(e.key + " → " + e.producer + " 出现在 " + hits.slice(0, 2).join(", "));
  }
  ok("★★★ 每条 NONE 的 producer 都匹配不到（标着没实现就真的没有代码）", bad.length === 0, JSON.stringify(bad));
  console.log("    这条与 [3] 互补：只查正向会放过「标着没实现、其实已经有代码」的漏报。");
}

sec("[5] ★★ capability 链：挂上去的 key 必须真实存在");
{
  const keys = new Set(CAPABILITIES.map((c: any) => c.key));
  const bad = EFFECT_KINDS.filter(e => e.capability && !keys.has(e.capability)).map(e => e.key + " → " + e.capability);
  ok("★★ 所有非 null 的 capability 都是官方 48 条里的 key", bad.length === 0, JSON.stringify(bad));
  const linked = EFFECT_KINDS.filter(e => e.capability).length;
  console.log("    " + linked + " / " + EFFECT_KINDS.length + " 条挂到了官方能力上；其余挂 null 并在说明里写清原因");
}

sec("[6] ★★★ 顺带钉住两条实测发现：两个「读得到、永远不为真」的分支");
{
  const et = EFFECT_KINDS.find(e => e.key === "ExtraTurn")!;
  // Rewritten to the facts (same pattern as Transform below): NEW_TURN got a producer (kernel/extra-turn.ts,
  //   called by the 轮入道 soul) — the turn type is now started by Battle.runExtraTurns, and nowhere else.
  ok("★★ ExtraTurn 标为 PARTIAL + WIRED（grantExtraTurn 有调用方）", et.support === "PARTIAL" && et.reach === "WIRED");
  ok("★★ TurnType.NEW_TURN 只由 Battle.runExtraTurns 发起（生产代码里恰好 1 处）",
    find("TurnType.NEW_TURN").length === 1 && /kernel\/battle\.ts/.test(find("TurnType.NEW_TURN")[0]),
    JSON.stringify(find("TurnType.NEW_TURN").slice(0, 3)));

  const tr = EFFECT_KINDS.find(e => e.key === "Transform")!;
  ok("★★★ Transform 第 101 轮起是 PARTIAL + WIRED（transformed 有生产写入方了，见下面几条）",
    tr.support === "PARTIAL" && tr.reach === "WIRED", tr.support + " + " + tr.reach);
  /**
   * ★★★ 第 101 轮：这条断言**按事实改写**了 —— 它原本写的是「生产代码里确实没有 transformed = true 这一行」，
   *   而形态入场（kernel/summon.ts 的 enterForm）现在真的写这一行。这与 undeathUsed / reviveBlocked 是同一模式：
   *   **"有读者、没有写入方"的字段每修好一个，这里就要跟着改一次，而不是把断言删掉了事。**
   *   反向仍然要成立：写入方存在 **且** 读取方也存在（只写不读 = 又一个死字段）。
   */
  ok("★★★ transformed 现在**有**生产写入方（第 101 轮形态入场），写入方与读取方同时存在",
    find("transformed = true").length > 0 && find("target.transformed").length > 0,
    JSON.stringify([find("transformed = true").slice(0, 2), find("target.transformed").slice(0, 2)]));
  // 对照：读取方是**真的存在**的，所以这不是「搜错了关键词」
  ok("★★ 但读取方确实存在（对照：证明不是关键词写错）",
    find("target.transformed").length > 0, JSON.stringify(find("target.transformed").slice(0, 2)));
  /**
   * ★★★ 第 94 轮：这一条**转向**了。原文是：
   *   const fam = ["reviveBlocked = true", "undeathUsed = true"].filter(m => find(m).length === 0);
   *   ok("同族的 reviveBlocked / undeathUsed 也没有生产写入方（整个复活子系统只有测试在走）", fam.length === 2)
   *
   * 第 94 轮把两个都接上了，而且**接线方式不同**，所以判据也要分别写：
   *   · undeathUsed：免死触发时**直接置 true**（kernel/damage.ts）——按原来的字串判据就能查到；
   *   · reviveBlocked：它是**状态的派生值**（kernel/entity.ts 的 refreshReviveBlock 按
   *     「身上有没有 blocksRevive 的状态」重算），所以形如 `reviveBlocked = true` 的字串
   *     **永远不该出现** —— 出现了反而说明有人绕过了唯一写入方。
   * ⇒ 一条断言拆成两条，各自钉住"它现在真的会被写"和"写入方只有一个"。
   */
  ok("★★★ undeathUsed 现在有生产写入方（免死触发时置 true）", find("undeathUsed = true").length > 0,
    JSON.stringify(find("undeathUsed = true").slice(0, 2)));
  ok("★★★ reviveBlocked 由 refreshReviveBlock 派生（唯一写入方），而不是被到处硬置 true",
    find("refreshReviveBlock").length > 0 && find("reviveBlocked = true").length === 0,
    JSON.stringify({ refresh: find("refreshReviveBlock").length, hard: find("reviveBlocked = true").length }));
  /**
   * ★★★ 第 101 轮：三个"有读者、没有写入方"的字段**全部**修好了（undeathUsed → reviveBlocked → transformed）。
   *   这条对照的意义也随之改变：它不再是"剩下一个还没修"，而是"三个都有写入方了"。
   *   留着它的价值在于：**任何一天有人把某个写入方删掉，这里会立刻变红。**
   */
  ok("★★ 对照：transformed 的写入方仍然在（三个此类字段已全部接线：undeathUsed / reviveBlocked / transformed）",
    find("transformed = true").length > 0);

  const ps = EFFECT_KINDS.find(e => e.key === "PseudoAction")!;
  // ★★★ 第 95 轮：这一条**转向**了。原文是：
  //   ok("PseudoAction 不再标 FULL（入口在、没有调用方）", ps.support === "PARTIAL" && ps.reach === "ORPHAN")
  //   —— 第 56 轮把 FULL 降成 PARTIAL，理由正是"没有任何调用方"。
  //   第 95 轮 `Battle.counterAttack` 成了真实调用方 ⇒ reach 必须是 **WIRED**；
  //   而 support 仍是 PARTIAL：入口有了，但**从真实数据走不到**（全库 0 条技能同时满足两个条件）。
  ok("★★★ PseudoAction：reach 由 ORPHAN 变 WIRED（有调用方了），support 仍是 PARTIAL（真实数据走不到）",
    ps.support === "PARTIAL" && ps.reach === "WIRED", ps.support + "/" + ps.reach);
  ok("★★ 与 capability 表 COUNTER 的口径一致（不是两套说法）",
    CAPABILITIES.some((c: any) => c.key === "COUNTER" && c.support === "PARTIAL"));
  console.log("    也就是说：额外回合（NEW_TURN）、反击/协战（PSEUDO_TURN）、变形、复活这四条，");
  console.log("    引擎里都只有入口或标记，**没有任何东西会发起它们** —— 与 capability 表同源。");
}

sec("[7] ★★★ 登记闸门（第 243 轮）：新机制落地 ⇒ 必须被**已存在**的条目点名（而不是新造 key）");
{
  /**
   * 由来：第 239–242 轮落了两个机制（计数器 / 效果位条件变体）。这张表是 a1-4 §16 的**封闭清单**
   *   （[2] 段明写「不许自造条目」）⇒ 新机制不能新开 key，必须在**已存在**的条目说明里点名。
   *   而「点名」这件事此前**没有任何闸门**：说明写没写、写得对不对，全靠人自觉。
   * 判据三条（每条都能被机器验）：① 机制标记在生产代码里真有执行点；
   *   ② 机制的 IR 键名出现在对应条目的 note 里；③ 尺子文件真的存在。
   * ★ 这不是通用规则（「每个新机制都该登记」不可判定），是一条**会随轮次增长的钉子清单**：
   *   下一轮再落新机制时往 MECHANISMS 里加一行 —— 加之前，它不算被登记。
   */
  const MECHANISMS = [
    { marker: "ghostEyeDef(", entry: "AddStatus", name: "counterCast", ruler: "tests/g118-counter-cast.ts" },
    { marker: "branch_pick:", entry: "Control", name: "controlRefs[].variant", ruler: "tests/g121-control-variant.ts" },
    { marker: "damageSegments", entry: "Damage", name: "damageSegments", ruler: "tests/g129-damage-segments.ts" },
    { marker: "typeOfDamageTail", entry: "Damage", name: "typeOfDamageTail", ruler: "tests/g130-damage-type.ts" },
    { marker: "selfHpLoss", entry: "HP Loss", name: "selfHpLoss", ruler: "tests/g131-self-hp-loss.ts" },
  ];
  const bad: string[] = [];
  for (const m of MECHANISMS) {
    const e = EFFECT_KINDS.find(x => x.key === m.entry);
    if (!e) { bad.push(m.entry + " 不在表里"); continue; }
    if (find(m.marker).length === 0) bad.push(m.name + " 的标记 " + m.marker + " 在生产代码里找不到执行点");
    if (!e.note.includes(m.name)) bad.push(m.name + " 没有被 " + m.entry + " 的说明点名");
    /** ★ 尺子路径按 **battle-lab 相对**写（root 是仓库根 —— 第一版直接 join(root, ruler) 报了"文件不存在"） */
    if (!fs.existsSync(path.join(root, "battle-lab", m.ruler))) bad.push(m.name + " 的尺子 " + m.ruler + " 不存在");
  }
  ok("★★★ 每个新机制：有执行点 + 被已有条目点名 + 有尺子（" + MECHANISMS.length + " 条）", bad.length === 0, JSON.stringify(bad));
  /** 反向对照：把条目的说明换掉 ⇒ 必须报「没被点名」（证明这条判据真的在看那一格） */
  const tampered = EFFECT_KINDS.map(x => x.key === "AddStatus" ? { ...x, note: "（探针：把说明清空）" } : x);
  const miss = MECHANISMS.filter(m => { const e = tampered.find(x => x.key === m.entry); return !e || !e.note.includes(m.name); }).length;
  ok("★★★ 反向：把对应条目的说明换成别的 ⇒ 立刻报「没被点名」", miss >= 1, String(miss));
  ok("★★ 而且钉子清单**没有**新造 key（[2] 段的封闭性不被破坏）",
    MECHANISMS.every(m => EFFECT_KINDS.some(x => x.key === m.entry)), JSON.stringify(MECHANISMS.map(m => m.entry)));
  console.log("    钉子清单：" + MECHANISMS.map(m => m.name + " → " + m.entry).join("｜"));
}

console.log("\n=== Effect Registry 可证伪性: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
