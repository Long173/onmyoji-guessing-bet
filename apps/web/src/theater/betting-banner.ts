// theater/betting-banner.ts — Action Banner cases for trace events emitted by the hand-written betting kits
// (battle-lab/compile/betting-*.ts). Split out of presenter.ts to keep that file readable; ui13 scans both files.
//
// Same contract as Presenter.banner(): pure, no Vue, no engine execution. Names and skills are passed through as
// the engine wrote them (often Chinese); the theater translates the finished banner for display (kb/en-engine.ts).
import type { ReplayFrame } from "../../../../battle-lab/kernel/replay.ts";
import type { BannerView } from "./presenter.ts";

type Nm = (id: any) => string | undefined;
type Line = BannerView["lines"][number];

const s = (v: unknown, dflt = "?") => (v === undefined || v === null || v === "" ? dflt : String(v));
const r = (v: unknown) => String(Math.round(Number(v ?? 0)));
const pct = (v: unknown) => String(Math.round(Number(v ?? 0) * 100)) + "%";
const turns = (n: unknown) => String(n) + (Number(n) === 1 ? " turn" : " turns");
const STYLE: Record<string, string> = { SNOW: "Snow style", SKY: "Clear Sky style", NONE: "No style" };
const style = (v: unknown) => STYLE[String(v)] ?? s(v);

/** Banner for a betting-kit trace event, or null when the type is not one of them. */
export function bettingBanner(fr: ReplayFrame, nm: Nm): BannerView | null {
  const lines: Line[] = [];
  const out = (kind: BannerView["kind"], extra: Partial<BannerView> = {}): BannerView => ({ kind, lines, code: fr.t, ...extra });
  switch (fr.t) {
    case "ASSIST":
      lines.push({ label: "Assist", value: s(fr.skill) + " → " + s(nm(fr.target), "—"), tone: "resist" });
      lines.push({ label: "With", value: s(nm(fr.ally), "—") + (fr.chance != null ? " · chance " + pct(fr.chance) : "") });
      return out("SKILL", { actor: nm(fr.actor), target: nm(fr.target), skill: fr.skill });
    case "BLOOD_ABSORB":
      lines.push({ label: "Blood absorbed", value: r(fr.absorbed) + " damage", tone: "resist" });
      lines.push({ label: "Points left", value: r(fr.pointsLeft) });
      return out("STATUS", { target: nm(fr.dst) });
    case "CHALLENGE":
      lines.push({ label: "Challenge", value: s(nm(fr.actor), "—") + " must attack " + s(nm(fr.target), "—"), tone: "warn" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.target), skill: fr.skill });
    case "COFFIN_STRIKE":
      lines.push({ label: "Coffin strike", value: String((fr.targets ?? []).length) + " target(s) · " + s(fr.onibi, "0") + " Onibi", tone: "crit" });
      if (fr.ratio != null) lines.push({ label: "Ratio", value: s(fr.ratio) + (fr.mul != null ? " × " + s(fr.mul) : "") });
      return out("SKILL", { actor: nm(fr.actor), skill: fr.skill });
    case "COUNTER_TRIGGER":
      lines.push({ label: "Counter triggered", value: s(fr.skill) + (fr.reason ? " (" + s(fr.reason) + ")" : ""), tone: "resist" });
      return out("SKILL", { actor: nm(fr.actor), target: nm(fr.target), skill: fr.skill });
    case "CRIT_CANCELLED":
      lines.push({ label: "Crit cancelled", value: "by " + s(fr.by) + " (" + s(fr.stacks, "0") + " stack(s), " + s(fr.keep, "0") + " kept)", tone: "resist" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill });
    case "DAMAGE_BOOST":
      lines.push({ label: "Damage boosted", value: s(fr.name ?? fr.by) + " · ×" + Number(fr.mul ?? 1).toFixed(2) + (fr.reason ? " (" + s(fr.reason) + ")" : ""), tone: "crit" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill });
    case "DAMAGE_REDUCED":
      lines.push({ label: "Damage reduced", value: s(fr.by) + " · " + pct(fr.ratio), tone: "resist" });
      return out("STATUS", { target: nm(fr.id) });
    case "DAMAGE_SHARED":
      lines.push({ label: "Damage shared", value: r(fr.amount) + " taken for " + s(nm(fr.ally), "—"), tone: "resist" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.ally), skill: fr.skill });
    case "DANDELION_SPEND":
      lines.push({ label: "Dandelion Force spent", value: r(fr.amount) + " (" + r(fr.before) + " → " + r(fr.after) + ")", tone: "crit" });
      if (fr.reason) lines.push({ label: "For", value: s(fr.reason) });
      return out("SKILL", { actor: nm(fr.id), skill: fr.skill });
    case "DANDELION_STORE":
      lines.push({ label: "Dandelion Force stored", value: "+" + r(fr.amount) + " (now " + r(fr.after) + ")", tone: "heal" });
      if (fr.reason) lines.push({ label: "From", value: s(fr.reason) + (fr.dst != null ? " · " + s(nm(fr.dst), "—") : "") });
      return out("STATUS", { actor: nm(fr.id), target: nm(fr.dst), skill: fr.skill });
    case "DOUJO_SACRIFICE":
      lines.push({ label: "Sacrifice", value: "-" + r(fr.sacrifice) + " HP (from " + r(fr.hpBefore) + ")", tone: "warn" });
      lines.push({ label: "Heal allies", value: "+" + r(fr.heal) + (fr.healsSelf ? " (self included)" : ""), tone: "heal" });
      return out("SKILL", { actor: nm(fr.actor), skill: fr.skill });
    case "ECHO_HIT":
      lines.push({ label: "Echo", value: s(fr.allySkill) + " of " + s(nm(fr.ally), "—") + " · " + pct(fr.ratio) + " ATK", tone: "crit" });
      return out("SKILL", { actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill });
    case "EXTRA_ATTACK":
      lines.push({ label: "Extra normal attack", value: s(nm(fr.actor), "—") + " → " + s(nm(fr.target), "—") + (fr.chance != null ? " · chance " + pct(fr.chance) : ""), tone: "crit" });
      return out("SKILL", { actor: nm(fr.actor), target: nm(fr.target), skill: fr.skill });
    case "FEAST":
      lines.push({ label: "Feast", value: r(fr.mealDamage) + " meal damage · " + r(fr.perEnemy) + " to each of " + s(fr.enemies, "0") + " enemies", tone: "crit" });
      return out("SKILL", { actor: nm(fr.id), skill: fr.skill });
    case "FEAST_SKIPPED":
      lines.push({ label: "Feast skipped", value: fr.reason === "DEAD" ? "Eater is defeated" : fr.reason === "CANNOT_ACT" ? "Eater cannot act" : s(fr.reason), tone: "warn" });
      return out("OTHER", { actor: nm(fr.id) });
    case "HEAL_SPLASH":
      lines.push({ label: "Heal splash", value: r(fr.each) + " to each other ally (" + pct(fr.ratio) + " of " + r(fr.healed) + ")", tone: "heal" });
      return out("SKILL", { actor: nm(fr.src), target: nm(fr.main), skill: fr.skill });
    case "MEAL_FINISHED":
      lines.push({ label: "Meal finished", value: r(fr.damage) + " damage stored · feast in " + turns(fr.feastIn ?? 1) });
      return out("STATUS", { actor: nm(fr.chef), target: nm(fr.id), skill: fr.skill });
    case "FIELD_OPEN":
      lines.push({ label: "Field opened", value: s(fr.name) + (fr.turns != null ? " for " + turns(fr.turns) : "") });
      if (fr.masks != null) lines.push({ label: "Masks", value: s(fr.masks) });
      if (fr.reason) lines.push({ label: "Reason", value: s(fr.reason) });
      return out("OTHER", { actor: nm(fr.owner), skill: fr.skill });
    case "FIELD_CLOSE":
      lines.push({ label: "Field closed", value: s(fr.name) + " · " + s(fr.reason, "—") });
      return out("OTHER", { actor: nm(fr.owner) });
    case "FIELD_MASK":
      lines.push({ label: "Field mask broken", value: s(fr.name) + " · " + s(fr.left, "0") + " left" });
      return out("OTHER", { actor: nm(fr.by), target: nm(fr.owner) });
    case "FIELD_DURATION":
      lines.push({ label: "Field duration", value: s(fr.name) + " · " + turns(fr.turns ?? 1) + (fr.counted === "OWNER_TURNS" ? " (owner's turns)" : "") });
      return out("OTHER", { actor: nm(fr.owner), skill: fr.skill });
    case "IGNORE_SOULS_PASSIVES":
      lines.push({ label: "Ignores Souls and passives", value: "this cast" + (fr.provided != null ? " · Wish Power provided " + s(fr.provided) : ""), tone: "warn" });
      return out("SKILL", { actor: nm(fr.actor), skill: fr.skill });
    case "KAGUYA_PARTIAL_CAST":
      lines.push({ label: "Partial-Onibi cast", value: "paid " + s(fr.paid, "0") + " of " + s(fr.cost, "?"), tone: "warn" });
      lines.push({ label: "HP sacrificed", value: pct(fr.sacrifice) + " of current HP" });
      lines.push({ label: "Illusion left", value: turns(fr.illusionTurnsLeft ?? 0) });
      return out("SKILL", { actor: nm(fr.actor), skill: fr.skill });
    case "MAX_HP_CHANGE":
      lines.push({ label: "Max HP", value: fr.before != null ? r(fr.before) + " → " + r(fr.after) : (Number(fr.by ?? 0) >= 0 ? "+" : "") + r(fr.by) + " → " + r(fr.maxHp), tone: "warn" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.id), skill: fr.skill });
    case "MAX_HP_UP":
      lines.push({ label: "Max HP up", value: "+" + pct(fr.ratio) + " → " + r(fr.maxHp), tone: "heal" });
      return out("STATUS", { target: nm(fr.id), skill: fr.skill });
    case "MAX_ORB_CHANGE":
      lines.push({ label: "Max Onibi", value: s(fr.maxOrb) + " (" + (Number(fr.delta ?? 0) >= 0 ? "+" : "") + s(fr.delta, "0") + ")", tone: "warn" });
      lines.push({ label: "Team", value: fr.team === 0 ? "Red" : fr.team === 1 ? "Blue" : s(fr.team) });
      return out("ORB", { skill: fr.skill });
    case "NIGHT_PACT":
      lines.push({ label: "Night Pact", value: "#" + s(fr.count) });
      return out("STATUS", { actor: nm(fr.src), skill: fr.skill });
    case "ORB_GAUGE_BLOCKED":
      lines.push({ label: "Onibi gauge blocked", value: s(fr.name ?? fr.status), tone: "warn" });
      return out("ORB", { actor: nm(fr.actor) });
    case "PASSIVE_PROC":
      lines.push({ label: "Passive triggered", value: s(fr.effect) + (fr.chance != null ? " · chance " + pct(fr.chance) : ""), tone: "resist" });
      return out("STATUS", { actor: nm(fr.actor), skill: fr.skill });
    case "PASSIVE_ROLL":
      lines.push({ label: "Passive roll", value: "chance " + pct(fr.probability) + " · " + (fr.hit ? "hit" : "miss"), tone: fr.hit ? "normal" : "warn" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill });
    case "POSSESS_CONSUMED":
      lines.push({ label: "Possession consumed", value: "Max HP -" + r(fr.maxHpLost), tone: "warn" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.id), skill: fr.skill });
    case "REFLECT":
      lines.push({ label: "Reflect", value: r(fr.amount) + " damage (" + pct(fr.ratio) + " of " + r(fr.taken) + ")", tone: "crit" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill });
    case "RIFT_TICK":
      lines.push({ label: "Rift damage", value: r(fr.amount) + " (" + s(fr.stacks, "0") + " stack(s))", tone: "crit" });
      return out("OTHER", { actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill });
    case "SKILL_FORM":
      lines.push({ label: "Cast as", value: s(fr.as) + (fr.strikes != null ? " · " + s(fr.strikes) + " strike(s)" : "") + (fr.ratio != null ? " · " + s(fr.ratio) + "% ATK" : "") });
      return out("SKILL", { actor: nm(fr.actor), skill: fr.skill });
    case "STACKS_GAINED":
      const count = fr.from != null ? s(fr.from) + " → " + s(fr.to) : "→ " + s(fr.stacks);
      lines.push({ label: "Stacks gained", value: s(fr.name) + " " + count + (fr.reason === "5_ATTACKS" ? " (every 5 attacks)" : fr.reason ? " (" + s(fr.reason) + ")" : "") });
      return out("STATUS", { actor: nm(fr.id), skill: fr.skill });
    case "STACKS_SET":
      lines.push({ label: "Stacks", value: s(fr.name ?? fr.status) + " " + s(fr.from, "0") + " → " + s(fr.to, "0") });
      return out("STATUS", { actor: nm(fr.id), skill: fr.skill });
    case "STATUS_REFLECT":
      lines.push({ label: "Status reflected", value: s(fr.name ?? fr.status) + " · " + turns(fr.duration ?? 1), tone: "resist" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill });
    case "STYLE_SWITCH":
      lines.push({ label: "Style switch", value: style(fr.from) + " → " + style(fr.to) });
      return out("STATUS", { actor: nm(fr.id), skill: fr.skill });
    case "SUBSKILL":
      lines.push({ label: "Sub-skill", value: s(fr.skill) + " (from " + s(fr.form) + ")" + (fr.heals != null ? " · " + s(fr.heals) + " heal(s)" : "") });
      return out("SKILL", { actor: nm(fr.actor), skill: fr.skill });
    case "SUMMON":
      lines.push({ label: "Summon", value: s(fr.name) + " for " + turns(fr.turns ?? 1) + (fr.counted === "OWNER_TURNS" ? " (owner's turns)" : ""), tone: "resist" });
      return out("OTHER", { actor: nm(fr.owner), skill: fr.skill });
    case "SUMMON_END":
      lines.push({ label: "Summon ended", value: s(fr.name) + " · " + s(fr.reason, "—") });
      return out("OTHER", { actor: nm(fr.owner) });
    case "UNDYING_HOLD":
      lines.push({ label: "Undying", value: "Stays on the field at 0 HP", tone: "resist" });
      return out("DEATH", { target: nm(fr.id), skill: fr.skill });
    case "UNDYING_END":
      lines.push({ label: "Undying ended", value: fr.reason === "LAST_ALLY_FELL" ? "Last ally fell" : s(fr.reason), tone: "warn" });
      return out("DEATH", { target: nm(fr.id), skill: fr.skill });
    case "WEDGE_CHOICE":
      lines.push({ label: "Wedge chosen", value: s(fr.name) + " (" + (fr.timing === "SKIP_TURN" ? "skip turn" : "at turn end") + ")" });
      lines.push({ label: "Offered", value: String((fr.offered ?? []).length) + " option(s) · bearer picks at random (assumption)" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.bearer) });
    case "WEDGE_TRIGGER":
      lines.push({ label: "Wedge triggered", value: s(fr.name) + " (" + (fr.timing === "SKIP_TURN" ? "skip turn" : "at turn end") + ")", tone: "crit" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.bearer) });
    case "WEDGE_SKIPPED":
      lines.push({ label: "Wedge skipped", value: fr.reason === "SOURCE_DEAD" ? "Source is defeated" : s(fr.reason), tone: "warn" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.bearer) });
    case "WEDGE_RESET":
      lines.push({ label: "Wedges reset", value: s(fr.hits, "0") + " hit(s)" + (fr.push != null ? " · action bar +" + pct(fr.push) : "") });
      return out("STATUS", { actor: nm(fr.src), skill: fr.skill });
    case "WISH_GAIN":
      lines.push({ label: "Wish Power", value: s(fr.before, "0") + " → " + s(fr.after, "0") + (fr.reason ? " (" + s(fr.reason) + ")" : "") });
      return out("STATUS", { actor: nm(fr.src), skill: fr.skill });
    case "WISH_SPEND":
      lines.push({ label: "Wish Power spent", value: s(fr.amount, "0") + " (" + s(fr.before, "0") + " → " + s(fr.after, "0") + ")", tone: "warn" });
      return out("STATUS", { actor: nm(fr.src), skill: fr.skill });
    // ── match 7 kits (betting-kaoru / enenra / enmusubi / yuki / hana279 / shuten / mannendake) ──
    case "BAR_IMMUNE":
      lines.push({ label: "Action bar change blocked", value: (Number(fr.percent ?? 0) >= 0 ? "+" : "") + pct(fr.percent) + " · " + s(fr.by), tone: "resist" });
      return out("TIMELINE", { target: nm(fr.id), skill: fr.skill });
    case "BIRDS":
      lines.push({ label: "Birds", value: s(fr.from, "0") + " → " + s(fr.to, "0") + (fr.reason ? " (" + s(fr.reason) + ")" : "") });
      return out("STATUS", { actor: nm(fr.id), skill: fr.skill });
    case "BURN":
      lines.push({ label: "Burned", value: "-" + r(fr.amount) + " HP (HP loss)", tone: "warn" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill });
    case "GLASS_SUMMON":
      lines.push({ label: "Summon", value: "Gentian Glass · HP " + r(fr.hp) + " · SPD " + r(fr.spd), tone: "resist" });
      if (fr.reason) lines.push({ label: "Reason", value: s(fr.reason) });
      return out("STATUS", { actor: nm(fr.owner), target: nm(fr.summon) });
    case "MARK_TRIGGER":
      lines.push({ label: "Mark triggered", value: s(fr.name ?? fr.status), tone: "resist" });
      return out("STATUS", { target: nm(fr.id), skill: fr.skill });
    case "OWL_ABSORB":
      lines.push({ label: "Owl's Guard absorbed", value: r(fr.absorbed) + " damage (recorded " + r(fr.recorded) + " / cap " + r(fr.cap) + ")", tone: "resist" });
      return out("STATUS", { actor: nm(fr.src), target: nm(fr.id), skill: fr.skill });
    case "OWL_SETTLE":
      lines.push({ label: "Owl's Guard settled", value: "-" + r(fr.loss) + " HP (" + pct(fr.ratio) + " of " + r(fr.recorded) + ")", tone: "warn" });
      if (fr.reason) lines.push({ label: "Reason", value: s(fr.reason) });
      return out("STATUS", { target: nm(fr.id), skill: fr.skill });
    case "SKILL_VARIANT":
      lines.push({ label: "Skill replaced", value: s(fr.skill) + " → " + s(fr.variant) + (fr.reason ? " (" + s(fr.reason) + ")" : ""), tone: "crit" });
      return out("SKILL", { actor: nm(fr.actor), skill: fr.variant ?? fr.skill });
    case "SMOKE_BLOCK":
      lines.push({ label: "Smoke Formlessness blocked", value: s(fr.kind) + (fr.src != null ? " from " + s(nm(fr.src), "—") : ""), tone: "resist" });
      return out("STATUS", { target: nm(fr.id), skill: fr.skill });
    case "SMOKE_PHANTOM_BURST":
      lines.push({ label: "Smoke Phantom burst", value: String((fr.targets ?? []).length) + " target(s)" + (fr.reason ? " (" + s(fr.reason) + ")" : ""), tone: "crit" });
      return out("SKILL", { actor: nm(fr.actor), target: nm(fr.bearer), skill: fr.skill });
    case "SNOW_BURST":
      lines.push({ label: "Snow Burst", value: "all enemies · " + s(fr.ratio) + "% ATK", tone: "crit" });
      return out("SKILL", { actor: nm(fr.src), target: nm(fr.designated), skill: fr.skill });
    case "STATE_SWITCH":
      lines.push({ label: "State", value: s(fr.state), tone: "resist" });
      return out("STATUS", { actor: nm(fr.id), skill: fr.skill });
    default:
      return null;
  }
}
