// kernel/fidelity-en.ts — English names and gap texts for the unmodelled-mechanic verbs (compile/unmodeled.ts,
// compile/skill-compiler.ts). Used by kernel/fidelity.ts when the report is produced in English
// (FidelityInput.lang = "en", the betting-mode web panel). The Chinese verb stays the key; an unlisted verb
// falls back to a neutral English sentence so no Chinese text reaches an English report.

export const UNMODELED_VERB_EN: Readonly<Record<string, { name: string; missing: string }>> = Object.freeze({
  偷取: { name: "steal", missing: "stealing buffs / onibi from the enemy has no behaviour code" },
  免疫: { name: "immunity", missing: "no stand-alone immunity check for this clause (generic skills; hand-written kits model their own)" },
  分摊: { name: "damage sharing", missing: "damage is never split / shared between units" },
  分段伤害形状: { name: "segment shape", missing: "the per-segment target shape of this multi-part damage is not modelled exactly" },
  协战: { name: "assist", missing: "the assist (协战) clause of a generic skill has no caller" },
  反伤: { name: "reflect damage", missing: "damage reflection written in a skill has no behaviour code" },
  反击: { name: "counter", missing: "only part of the counter rules run (active-skill counters, per-turn limits)" },
  受暴击触发: { name: "on-crit-taken trigger", missing: "effects that fire when the bearer takes a critical hit are not modelled" },
  变形: { name: "transform", missing: "transformation into another form is not modelled" },
  召唤: { name: "summon", missing: "the summoned unit of this generic skill is not created" },
  在场光环: { name: "presence aura", missing: "auras that last while the unit is on the field are not modelled" },
  复制: { name: "copy", missing: "copying skills / statuses has no behaviour code" },
  复活: { name: "revive", missing: "revival written in this skill is not modelled" },
  失血: { name: "HP loss", missing: "\"then lose N% max HP\" has no behaviour code" },
  孤立: { name: "isolation", missing: "isolated damage (cannot be shared / redirected) is not enforced" },
  庇护: { name: "protection", missing: "protection (block the next control) is not modelled for this generic skill" },
  承受者选择规则: { name: "recipient rule", missing: "the rule that picks the recipient by a stat (e.g. highest ATK ally) is not modelled" },
  收回: { name: "recall", missing: "recalling a summon / placed unit has no behaviour code" },
  暴击伤害转化: { name: "crit-damage conversion", missing: "crit damage never boosts non-crit damage" },
  暴击联动: { name: "crit chain", missing: "a crit does not raise the later segments of the same skill" },
  替换: { name: "skill swap", missing: "\"replaced by skill X\" (stance / state / field) does not swap the skill table for generic skills" },
  条件伤害分支: { name: "conditional damage branch", missing: "\"if X is open, this skill instead…\" has no branch: both branches' damage are compiled" },
  次数读成了上限: { name: "count read as cap", missing: "a repeat count was read as a cap" },
  花海: { name: "flower field", missing: "the flower-field mechanic is not modelled" },
  被动触发: { name: "passive trigger", missing: "the passive's trigger condition is not modelled" },
  转移: { name: "transfer", missing: "moving a status / mark from one unit to another is not modelled" },
  邀战: { name: "duel invite", missing: "the duel-invite mechanic is not modelled" },
  闪避: { name: "dodge", missing: "dodging is not modelled" },
  追加施放: { name: "follow-up cast", missing: "the Initiative / follow-up cast of another skill is not wired for this clause" },
});

const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;

/** English name of an unmodelled-mechanic verb (fallback keeps it readable without Chinese). */
export function verbEn(verb: string): string {
  const hit = UNMODELED_VERB_EN[verb];
  if (hit) return hit.name;
  return CJK.test(verb) ? "unlisted mechanic" : verb;
}

/** English description of what the engine lacks for this verb. */
export function verbMissingEn(verb: string): string {
  return UNMODELED_VERB_EN[verb]?.missing ?? "the engine has no behaviour code for this clause (see battle-lab/compile/unmodeled.ts)";
}

/** true when the text contains CJK characters (tests / fallbacks). */
export const hasCjk = (s: string): boolean => CJK.test(s);
