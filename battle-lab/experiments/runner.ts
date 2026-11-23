// experiments/runner.ts — 红区实验框架
// 目的不是"记录谁快"，而是：对每个候选假设各跑一遍实验室，
// 输出【判别性观测】（discriminating observable）——即"在游戏里看到 X 就是 H1，看到 Y 就是 H2"。
// 真正的一手观测必须来自游戏；本框架负责把观测成本降到最低。
import fs from "node:fs/promises";
import path from "node:path";

export interface Experiment {
  id: string;
  group: "A" | "B" | "C" | "D";
  question: string;
  /** 每个候选假设：名字 + 如何配置实验室 */
  hypotheses: Array<{ id: string; note: string; apply?: (p: any) => void }>;
  /** 跑一次实验室并返回可观测结果 */
  run: (policies: any) => Promise<any>;
  /** 在游戏里应该看什么 */
  inGameObservation: string;
}

export interface ExperimentResult {
  experiment: string;
  group: string;
  question: string;
  inGameObservation: string;
  hypotheses: Array<{ id: string; note: string; observable: any }>;
  /** 候选假设之间是否产生可区分的结果 */
  discriminating: boolean;
  /** CONFORMANCE = 单假设的官方一致性校验（不参与可判别率统计） */
  kind?: "HYPOTHESIS_TEST" | "CONFORMANCE";
  distinctObservables: number;
  confidence: "NOT_RUN" | "LOW" | "HIGH";
  status: "AWAITING_IN_GAME_OBSERVATION" | "RESOLVED";
  chosenHypothesis: string | null;
  gameVersion: string;
  recordedAt: string;
}

export async function runExperiment(e: Experiment): Promise<ExperimentResult> {
  const hypotheses = [];
  for (const h of e.hypotheses) {
    const policies: any = {};
    if (h.apply) h.apply(policies);
    let observable: any;
    try { observable = await e.run(policies); }
    catch (err: any) { observable = { error: String(err?.message ?? err) }; }
    hypotheses.push({ id: h.id, note: h.note, observable });
  }
  const keys = new Set(hypotheses.map(h => JSON.stringify(h.observable)));
  return {
    experiment: e.id, group: e.group, question: e.question,
    inGameObservation: e.inGameObservation,
    hypotheses,
    discriminating: keys.size > 1,
    distinctObservables: keys.size,
    kind: e.hypotheses.length === 1 ? "CONFORMANCE" : "HYPOTHESIS_TEST",
    confidence: "NOT_RUN",
    status: "AWAITING_IN_GAME_OBSERVATION",
    chosenHypothesis: null,
    gameVersion: "2026.10 (Data 快照)",
    recordedAt: new Date().toISOString(),
  };
}

export async function runAll(experiments: Experiment[], outDir: string) {
  await fs.mkdir(outDir, { recursive: true });
  const results: ExperimentResult[] = [];
  for (const e of experiments) {
    const r = await runExperiment(e);
    results.push(r);
    await fs.writeFile(path.join(outDir, `${e.id}.json`), JSON.stringify(r, null, 1), "utf8");
  }
  await fs.writeFile(path.join(outDir, "_all.json"), JSON.stringify(results, null, 1), "utf8");
  // verified-rules.json —— 只放已确证的规则，未跑的实验不放进来
  const verified = results.filter(r => r.status === "RESOLVED");
  await fs.writeFile(path.join(outDir, "..", "verified-rules.json"), JSON.stringify({
    _note: "仅包含 status=RESOLVED 的规则。所有 AWAITING_IN_GAME_OBSERVATION 的实验结果禁止用于产出胜率。",
    rules: verified,
  }, null, 1), "utf8");
  return results;
}
