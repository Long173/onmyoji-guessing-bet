// tools/event-audit.ts — ★★★ 第 119 轮：事件码覆盖率的**唯一口径**（四态账 + 证据行）
//
// 由来（实测，不是推理）：同一个问题在全库里有**两把尺子**，而且答案不同 ——
//   · tests/g42 的 `dispatched(code)` = `s.includes("dispatch(EV." + code) || s.includes("EV." + code + ",")`
//   · tools/_probe-dispatch.ts 用同一套正则
//   两者都把「有派发点」当成二值问题，于是把**三件不同的事**糊成一件：
//     ① 机制存在、且走事件总线   （BUS）        —— 被动 / 御魂 / 触发类机制今天就能挂
//     ② 机制存在、但只有 trace   （TRACE_ONLY） —— Theater 看得见，触发类机制**挂不上**
//     ③ 机制还没有，只是个名字   （MENTION_ONLY / DECLARED_ONLY）
//   ★★ 第 120 轮补一条通道：`queueEvent(...)`（Battle 的事件队列入口）。队列**就是**总线的一部分 ——
//     只是同步生产者（治疗/失血/状态/鬼火）不能 await 派发，所以先入队、由 Battle 在安全点 drain。
//     口径上 queueEvent 与 dispatch 同属 BUS（都真的会送到订阅者手里），不算 MENTION。
//   而且那套正则里 `EV.X,` 这一半**并不表示派发**：`ON_SKILL: EV.SKILL_END,`（御魂时机映射）
//   也会命中 —— 于是"有派发点的码"被多算，两个工具的 21 / 23 就是这么来的。
//
// 本模块只做一件事：把每个事件码按**通道**数出来，连**证据行**一起给（人能复核）。
// 通道判定写在下面三个正则里，改口径就改这里，别的工具一律 import 本模块。
import fs from "node:fs";
import path from "node:path";
import { producerScanFiles } from "./field-census.ts";

export type EvVerdict = "BUS" | "TRACE_ONLY" | "MENTION_ONLY" | "DECLARED_ONLY";
export interface EvSite { file: string; line: number; snippet: string }
export interface EvCoverage { code: string; verdict: EvVerdict; bus: EvSite[]; trace: EvSite[]; mention: EvSite[] }

/**
 * 把注释**遮盖**（而不是删掉）—— 保留偏移与行号。
 * ★ 不能直接用 field-census 的 stripComments：它把注释整段删掉，行号会漂，
 *   而本工具的每条结论都要能"按行号复核"。另外 types.ts 的注释里就写着 `dispatch("SOUL_START")`，
 *   不遮盖的话那 2 个裸字符串派发会被当成真的派发点（这正是第 91 轮踩过的坑）。
 */
export function maskComments(s: string): string {
  const block = s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
  return block.replace(/(^|[^:])\/\/[^\n]*/gm, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));
}

/** 事件码表：从 EV 声明块里抓 —— 表的正文是唯一来源，不许在这里手写清单 */
export function evCodes(root: string): string[] {
  const types = fs.readFileSync(path.join(root, "battle-lab", "kernel", "types.ts"), "utf8");
  const start = types.indexOf("export const EV = {");
  const block = types.slice(start, types.indexOf("} as const", start));
  return [...block.matchAll(/([A-Z_]+):\s*"[A-Z_]+"/g)].map(m => m[1]);
}

const lineOf = (s: string, i: number) => s.slice(0, i).split("\n").length;

export function evCoverage(root: string): { files: number; codes: EvCoverage[] } {
  const files = producerScanFiles(root).map(f => ({
    file: path.relative(root, f).split(path.sep).join("/"),
    raw: fs.readFileSync(f, "utf8"),
  })).map(x => ({ file: x.file, s: maskComments(x.raw) }));
  const codes = evCodes(root);
  const reports: EvCoverage[] = codes.map(code => {
    const bus: EvSite[] = [], trace: EvSite[] = [], mention: EvSite[] = [];
    const token = "(?:EV\\." + code + "\\b|[\"']" + code + "[\"'])";
    /**
     * ★ 第 122 轮：允许**可选调用**（`battle?.queueEvent?.(EV.X, …)`）—— 此前正则要求名字后面紧跟 `(`，
     *   于是 summon.ts 里两处 `queueEvent?.(` 被漏掉，TRANSFORM 被判成 MENTION_ONLY。
     *   口径上漏一个字符，账上就少一个码 —— 这正是「尺子本身要被盯着」的又一例。
     */
    const busRe = new RegExp("(?:dispatch|emit|publish|fire|queueEvent)\\s*\\??\\.?\\s*\\([\\s\\S]{0,48}?" + token, "g");
    const traceRe = new RegExp("(?:^|[\\s,{])t\\s*:\\s*[^,{}]{0,48}?" + token, "gm");
    const anyRe = new RegExp(token, "g");
    for (const { file, s } of files) {
      const push = (arr: EvSite[], m: RegExpExecArray) => {
        const line = lineOf(s, m.index);
        arr.push({ file, line, snippet: s.split("\n")[line - 1].trim().slice(0, 120) });
      };
      for (const m of s.matchAll(busRe)) push(bus, m as RegExpExecArray);
      for (const m of s.matchAll(traceRe)) push(trace, m as RegExpExecArray);
      for (const m of s.matchAll(anyRe)) {
        const line = lineOf(s, m.index);
        const snippet = s.split("\n")[line - 1].trim().slice(0, 120);
        if (snippet.includes(": \"" + code + "\"") && file.endsWith("kernel/types.ts")) continue;   // 声明处本身不算"用"
        if (bus.some(b => b.file === file && b.line === line) || trace.some(b => b.file === file && b.line === line)) continue;
        mention.push({ file, line, snippet });
      }
    }
    const verdict: EvVerdict = bus.length ? "BUS" : trace.length ? "TRACE_ONLY" : mention.some(m => !m.file.endsWith("kernel/types.ts")) ? "MENTION_ONLY" : "DECLARED_ONLY";
    return { code, verdict, bus, trace, mention };
  });
  return { files: files.length, codes: reports };
}

export function coverageSummary(root: string) {
  const { files, codes } = evCoverage(root);
  const byVerdict: Record<EvVerdict, string[]> = { BUS: [], TRACE_ONLY: [], MENTION_ONLY: [], DECLARED_ONLY: [] };
  for (const c of codes) byVerdict[c.verdict].push(c.code);
  return { files, total: codes.length, byVerdict, codes };
}

/**
 * 有效性证明：生产代码里**所有** dispatch / emit 调用点的第一个实参是什么形状。
 * 这是"按字面量扫描不会漏"的依据 —— 只要 variable 为 0，任何按 EV 表枚举的扫描都是完备的。
 * ★ 排除函数定义本身（events.ts 的 \`dispatch(code: string, ...)\`）。
 */
export function dispatchCallSites(root: string): { total: number; literal: number; bareString: string[]; variable: string[]; drainSites: number; ternary: string[] } {
  const files = producerScanFiles(root).map(f => ({ file: path.relative(root, f).split(path.sep).join("/"), s: maskComments(fs.readFileSync(f, "utf8")) }));
  const re = /(?:dispatch|emit|publish|fire|queueEvent)\s*\??\.?\s*\(\s*([^,)]{0,60})/g;
  let total = 0, literal = 0, drainSites = 0;
  const bareString: string[] = [], variable: string[] = [], ternary: string[] = [];
  for (const { file, s } of files) {
    for (const m of s.matchAll(re)) {
      const arg = m[1].trim();
      if (/^[a-z]+\s*:\s*string$/.test(arg)) continue;                     // 函数定义
      total++;
      if (/^EV\.[A-Z_]+$/.test(arg)) { literal++; continue; }
      if (/^"[A-Z_]+"$/.test(arg)) { bareString.push(file + " → " + arg); continue; }
      /**
       * ★ 唯一允许的变量码：**队列自己的 drain**（battle.ts 的 drainEvents 把入队时存下的 code 投出去）。
       *   那是队列这个间接层本身，不是「生产者用了变量码」。除了它，任何变量码都意味着一处
       *   按字面量扫描看不见的派发 —— 那才是这条普查要抓的东西。
       */
      if (/e\.code/.test(arg) && file.endsWith("kernel/battle.ts")) { drainSites++; continue; }
      /** 三元**字面量**（形如 \`recover ? EV.RECOVER : EV.HEAL\`）：两个分支都是 EV.* ⇒ 不是变量码，单列一栏 */
      if (/\?\s*EV\.[A-Z_]+\s*:\s*EV\.[A-Z_]+$/.test(arg)) { ternary.push(file + " → " + arg.replace(/\s+/g, " ").slice(0, 44)); continue; }
      variable.push(file + " → " + arg.slice(0, 40));
    }
  }
  return { total, literal, bareString, variable, drainSites, ternary };
}

const isMain = /[/\\]event-audit\.ts$/.test(process.argv[1] ?? "");
if (isMain) {
  const root = path.resolve(import.meta.dirname, "..", "..");
  const s = coverageSummary(root);
  const cs = dispatchCallSites(root);
  console.log("扫描文件 " + s.files + " 个｜事件码 " + s.total + " 个");
  console.log("  派发/入队调用点 " + cs.total + " 处：字面量 EV.* " + cs.literal + "｜裸字符串 " + cs.bareString.length + "｜变量码 " + cs.variable.length + "｜三元字面量 " + cs.ternary.length + "｜队列 drain 自身 " + cs.drainSites + (cs.variable.length ? " ← " + cs.variable.join(" / ") : ""));
  console.log("  BUS（走事件总线，触发类机制可挂）    " + s.byVerdict.BUS.length + "：" + s.byVerdict.BUS.join(" "));
  console.log("  TRACE_ONLY（机制在跑，但只有 trace）  " + s.byVerdict.TRACE_ONLY.length + "：" + s.byVerdict.TRACE_ONLY.join(" "));
  console.log("  MENTION_ONLY（只是被别处提到）        " + s.byVerdict.MENTION_ONLY.length + "：" + s.byVerdict.MENTION_ONLY.join(" "));
  console.log("  DECLARED_ONLY（只有声明）            " + s.byVerdict.DECLARED_ONLY.length + "：" + s.byVerdict.DECLARED_ONLY.join(" "));
  if (process.argv.includes("--detail")) {
    for (const c of s.codes) {
      console.log("\n" + c.code.padEnd(18) + c.verdict);
      for (const x of c.bus.slice(0, 3)) console.log("    BUS   " + x.file + ":" + x.line + "  " + x.snippet.slice(0, 100));
      for (const x of c.trace.slice(0, 3)) console.log("    TRACE " + x.file + ":" + x.line + "  " + x.snippet.slice(0, 100));
      for (const x of c.mention.slice(0, 2)) console.log("    MENT  " + x.file + ":" + x.line + "  " + x.snippet.slice(0, 100));
    }
  }
}
