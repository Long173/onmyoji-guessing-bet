// tests/ui26-en-everywhere.ts — the UI is English everywhere the engine's Chinese strings used to leak through.
//
// For every sample match in matches/ui/*.json (betting / MAX mode, like the web worker), render through the SSR harness:
//   ① the simulation results, all four tabs, after a small simulation through the same engine adapter
//      (incl. "Per-unit contribution" → "Skill usage");
//   ② a sample battle in the step-by-step replay viewer (event list + inspector);
//   ③ the battle theater: the banner of EVERY frame (same display path as the component: enBanner), plus a real
//      render with the inspector open on each tab at the first frame of every trace type (the event list inside the
//      inspector covers every frame's row);
//   ④ the shikigami detail drawer (Skills / AI / Soul tabs) for every unit in those lineups;
//   ⑤ the whole page shell (App).
// and assert there is no CJK (ideographs, CJK punctuation, full-width forms) in the rendered HTML — text and tooltips.
// ⑥ also: every AI condition / target rule / skill slot / note in the KB (all shikigami, not only the samples)
//    has an English rendering, so the AI tab is English for any unit a user picks;
// ⑦ every red-zone rule (results → policy notes, Mechanics Lab → red zones) has an English rendering.
//
// Allowed exceptions: none in rendered output. (Not rendered by default and therefore not checked: the replay
// viewer's "Show raw fields" dump, which is the engine payload verbatim by design.)
// Run: node apps/web/tests/ui26-en-everywhere.ts
import fs from "node:fs";
import path from "node:path";
import { setSkillLevelMode } from "../../../battle-lab/compile/max-level.ts";
import { createEngineAdapter } from "../src/adapters/engine-adapter.ts";
import { skillStatusOf } from "../src/contracts/fidelity-view.ts";
import { Presenter } from "../src/theater/presenter.ts";
import { enAiSkill, enBanner, enEngine } from "../src/kb/en-engine.ts";
import { displayName } from "../src/kb/names.ts";
import { buildHarness } from "../tools/ssr-harness/build.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..", "..");
const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;
const CJK_G = /[　-〿㐀-鿿豈-﫿＀-￯]+/g;
/** Up to 6 distinct CJK snippets with context (what is left to translate). */
const leaks = (html: string) => {
  const out = new Set<string>();
  for (const m of html.matchAll(CJK_G)) {
    out.add(html.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 30).replace(/\s+/g, " "));
    if (out.size >= 6) break;
  }
  return [...out].join("  ‖  ");
};

setSkillLevelMode("MAX");
const bundle = JSON.parse(fs.readFileSync(path.join(here, "..", "src", "engine", "bundle.json"), "utf8"));
const adapter = createEngineAdapter(bundle);
const built = await buildHarness();
ok("SSR harness built", built.ok, built.error ?? "");
const H: any = built.module;

const files = fs.readdirSync(path.join(ROOT, "matches", "ui")).filter(f => /^2026-11-23[a-f]?-lineup\.json$/.test(f)).sort();
ok("6 sample matches found", files.length === 6, files.join(", "));

for (const f of files) {
  sec(`[${f}]`);
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "matches", "ui", f), "utf8"));
  const match = j.match ?? j;
  const v: any = await adapter.validate(match);

  // ① results
  const sim: any = await adapter.simulate(match, { simulations: 40, seed: 20261123 }, () => {}, () => false);
  const usage = sim.battleStats.perUnit.flatMap((u: any) => Object.keys(u.skillUsage ?? {}));
  ok("simulation produced per-unit skill usage (Chinese keys from the engine)", usage.length > 0 && usage.some((k: string) => CJK.test(k)), String(usage.length));
  for (const tab of ["outcome", "uncertainty", "units", "samples"]) {
    const html: string = await H.renderResults(sim, v.fidelity, tab);
    if (tab === "units") ok("results / units tab shows the Skill usage column", /Skill usage/.test(html) && /×\d/.test(html), "");
    ok(`results / ${tab}: no CJK`, !CJK.test(html), leaks(html));
  }

  // ② replay viewer
  const seed = 1;
  const rep: any = await adapter.replay(match, seed);
  const viewer: string = await H.renderReplay(rep, seed);
  ok(`replay viewer: ${rep.events.length} events rendered, no CJK`, rep.events.length > 0 && !CJK.test(viewer), leaks(viewer));

  // ③ theater: every frame's banner + a real render per trace type with the inspector open
  const p = new Presenter(rep.replay);
  const bad: string[] = [];
  const firstOfType = new Map<string, number>();
  for (let i = 0; i < p.frameCount; i++) {
    const view = p.view(i);
    const fr: any = p.frame(i);
    if (fr && !firstOfType.has(fr.t)) firstOfType.set(fr.t, i);
    const b = enBanner(view?.banner);
    const txt = b ? [b.actor, b.target, b.skill, ...b.lines.flatMap(l => [l.label, l.value])].join(" ") : "";
    const names = (view?.units ?? []).map(u => enEngine(displayName(u.name))).join(" ");
    if (CJK.test(txt + names) && bad.length < 6) bad.push(`#${i} ${fr?.t}: ${leaks(txt + " " + names)}`);
  }
  ok(`theater: ${p.frameCount} frame banners in English`, bad.length === 0, bad.join(" ¦ "));
  const tabs = ["damage", "ai", "status", "rng", "chain"];
  let k = 0, theaterLeak = "", renders = 0;
  for (const [, i] of firstOfType) {
    const html: string = await H.renderTheater(rep.replay, seed, { initialFrame: i, initialInspector: true, initialTab: tabs[k++ % tabs.length] });
    renders++;
    if (CJK.test(html) && !theaterLeak) theaterLeak = `frame ${i}: ` + leaks(html);
  }
  ok(`theater: ${renders} renders (one per trace type, inspector open, tabs rotated) have no CJK`, renders > 10 && !theaterLeak, theaterLeak);

  // ④ detail drawer for every unit
  let drawerLeak = "", drawers = 0;
  for (const side of ["red", "blue"] as const) {
    for (const u of match[side].units) {
      if (!u.shikigamiId) continue;
      for (const tab of ["skills", "ai", "soul"] as const) {
        const html: string = await H.renderDrawer(u, tab, skillStatusOf(v.fidelity, side, u.name));
        drawers++;
        if (tab === "ai" && !/Skill choice|No AI data/.test(html) && !drawerLeak) drawerLeak = `${u.name} ai tab did not load`;
        if (CJK.test(html) && !drawerLeak) drawerLeak = `${displayName(u.name)} / ${tab}: ` + leaks(html);
      }
    }
  }
  ok(`detail drawer: ${drawers} renders (10 units × Skills / AI / Soul) have no CJK`, drawers === 30 && !drawerLeak, drawerLeak);
}

sec("[page shell]");
{
  const html: string = await H.renderApp();
  ok("App renders without CJK", !CJK.test(html), leaks(html));
}

sec("[KB AI data: every shikigami]");
{
  const detail = JSON.parse(fs.readFileSync(path.join(here, "..", "src", "kb", "shikigami-detail.json"), "utf8"));
  const left: string[] = [];
  let n = 0;
  for (const [id, d] of Object.entries<any>(detail)) {
    const ai = d.ai;
    if (!ai) continue;
    const byName = new Map<string, string>((d.skills ?? []).map((s: any) => [s.name, s.name]));
    const texts = [
      ...(ai.cast ?? []).flatMap((c: any) => [enEngine(c.cond), enAiSkill(c.skill, (x) => (byName.has(x) ? "S" : undefined), () => "S")]),
      ...(ai.target ?? []).flatMap((t: any) => [enEngine(t.rule), enAiSkill(t.skill, (x) => (byName.has(x) ? "S" : undefined), () => "S")]),
      enEngine(ai.note ?? ""),
    ];
    n += texts.length;
    for (const t of texts) if (CJK.test(t) && left.length < 12) left.push(`${id}: ${t}`);
  }
  ok(`all ${n} AI strings of the KB have an English rendering`, left.length === 0, left.join(" ¦ "));
}

sec("[red-zone register: results policy notes + Mechanics Lab red zones]");
{
  const exp = JSON.parse(fs.readFileSync(path.join(here, "..", "src", "kb", "experiments.json"), "utf8"));
  const left = (exp.redZones as any[]).flatMap(z => [z.zone, z.question, z.evidence]).filter(Boolean).map(enEngine).filter(t => CJK.test(t));
  ok(`all ${exp.redZones.length} red-zone rules (zone / question / evidence) have an English rendering`, left.length === 0, left.slice(0, 6).join(" ¦ "));
}

setSkillLevelMode("BASE");
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
