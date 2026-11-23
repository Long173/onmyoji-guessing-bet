// lab/observations.ts — 观测登记仓库（localStorage，纯函数式 API）
//
// ★★ 这个仓库**只存观测**：登记一条观测不会把任何规则改成 VERIFIED。
//    状态变更必须人工复核后手改 battle-lab/experiments/verified-rules.json ——
//    否则「有人填了张表」就会被当成「机制已被验证」，这是本项目最不能接受的那种谎。
//
// 容错纪律：localStorage 不存在 / 被禁用 / JSON 损坏 / 配额满 —— 一律不抛异常。
//   · 存储不可用时退化为模块内存（同一次会话内仍然一致）；
//   · JSON 损坏时 loadAll() 返回空数组，而不是抛；
//   · 字段缺失的条目按原值保留，枚举值不认识就原样留着（绝不改写成另一个来源）。
export const OBSERVATIONS_KEY = "yys.lab.observations.v1";

export type ObservationSource = "IN_GAME" | "COMMUNITY" | "DATAMINE" | "THEORY";
export const OBSERVATION_SOURCES: readonly ObservationSource[] = ["IN_GAME", "COMMUNITY", "DATAMINE", "THEORY"];
// ★★ 第 63 轮：收紧成闭合 Record —— 词表与标签表在同一个文件里，但此前**没有任何东西在比它们**。
//   加一个来源却忘了加标签 ⇒ 界面显示空白。现在这是编译错误，由 tests/ui12-typecheck.ts 在套件里跑。
export const OBSERVATION_SOURCE_LABEL: Record<ObservationSource, string> = {
  IN_GAME: "In-game test",
  COMMUNITY: "Community source",
  DATAMINE: "Datamine",
  THEORY: "Theory",
};

export type ObservationConfidence = "LOW" | "MEDIUM" | "HIGH";
export const OBSERVATION_CONFIDENCES: readonly ObservationConfidence[] = ["LOW", "MEDIUM", "HIGH"];
export const OBSERVATION_CONFIDENCE_LABEL: Record<ObservationConfidence, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

export interface ObservationRecord {
  id: string;
  experimentId: string;
  /** ISO 时间戳字符串 */
  observedAt: string;
  source: ObservationSource;
  claim: string;
  evidenceText: string;
  confidence: ObservationConfidence;
  author: string;
}

/** add() 的入参：id / observedAt 可以不给，由仓库生成 */
export type ObservationInput = Omit<ObservationRecord, "id" | "observedAt"> & { id?: string; observedAt?: string };

export interface ObservationStats {
  total: number;
  bySource: Record<string, number>;
  byExperiment: Record<string, number>;
}

/** 展示给用户的政策说明（MechanicsView 复用同一句，避免两处措辞漂移） */
export const OBSERVATION_POLICY_NOTE =
  "Logging an observation only records it; it never marks a rule as VERIFIED automatically — status changes require manual review and an edit to verified-rules.json, " +
  "so that \"someone filled in a form\" is never mistaken for \"the mechanic has been verified\".";

// ───────── 存储访问（全部包在 try 里，绝不抛） ─────────

/** 存储不可用 / 写失败时的会话内数据（初始为空，绝不假装已持久化） */
let memory: ObservationRecord[] = [];
/** 写入失败过（配额满 / 隐私模式）→ 本会话内改为以内存为准，避免登记完就消失 */
let storageBroken = false;

function open(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls || typeof ls.getItem !== "function" || typeof ls.setItem !== "function") return null;
    return ls;
  } catch {
    return null;
  }
}

function newId(taken: Set<string>): string {
  for (let i = 0; i < 64; i++) {
    const id = "obs-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    if (!taken.has(id)) return id;
  }
  return "obs-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

/** 枚举值原样保留：不认识的来源不会被改写成另一个来源，UI 显示「未知来源」 */
function keepEnum<T extends string>(v: unknown): T {
  return str(v) as T;
}

/** 单条归一化：不是对象就丢弃（无法复核的垃圾数据），对象则尽量保留原值 */
function coerce(raw: unknown, taken: Set<string>): ObservationRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id) || newId(taken);
  taken.add(id);
  return {
    id,
    experimentId: str(o.experimentId),
    observedAt: str(o.observedAt) || new Date().toISOString(),
    source: keepEnum<ObservationSource>(o.source),
    claim: str(o.claim),
    evidenceText: str(o.evidenceText),
    confidence: keepEnum<ObservationConfidence>(o.confidence),
    author: str(o.author),
  };
}

/** 读原始顺序（插入序），不做排序 —— 排序只在 loadAll / listFor 的副本上做 */
function read(): ObservationRecord[] {
  const ls = open();
  if (!ls) return memory.slice();          // 没有 localStorage → 会话内存（初始为空）
  if (storageBroken) return memory.slice(); // 写不进去过 → 以内存为准，别丢刚登记的
  try {
    const raw = ls.getItem(OBSERVATIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];      // 结构不对 → 当作空，不抛
    const taken = new Set<string>();
    const out: ObservationRecord[] = [];
    for (const item of parsed) {
      const rec = coerce(item, taken);
      if (rec) out.push(rec);
    }
    return out;
  } catch {
    return [];                                   // JSON 损坏 → 空数组，不抛
  }
}

function write(list: ObservationRecord[]): void {
  memory = list;
  const ls = open();
  if (!ls) return;                          // 存储不存在：内存即全部，不算「坏」
  try {
    ls.setItem(OBSERVATIONS_KEY, JSON.stringify(list));
    storageBroken = false;
  } catch {
    // 配额满 / 隐私模式 → 退化为内存，本会话内仍然可读可写，但不假装已持久化
    storageBroken = true;
  }
}

/** 时间倒序（同一时间戳则后登记的在前）。sort 是稳定的，所以先 reverse 再按时间排。 */
function newestFirst(list: ObservationRecord[]): ObservationRecord[] {
  return list.slice().reverse().sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}

// ───────── 公开 API ─────────

/** 全部观测（时间倒序）。存储不可用 / JSON 损坏 → 返回空数组（或内存副本），绝不抛。 */
export function loadAll(): ObservationRecord[] {
  return newestFirst(read());
}

/** 某个实验的观测（时间倒序） */
export function listFor(experimentId: string): ObservationRecord[] {
  return loadAll().filter(r => r.experimentId === experimentId);
}

/**
 * 登记一条观测。experimentId 与 claim 不能为空（空表填进去等于没填，会污染统计）——
 * 这种情况直接抛，让调用方明确报错，而不是静默存一条废记录。
 */
export function add(input: ObservationInput): ObservationRecord {
  const experimentId = str(input.experimentId).trim();
  const claim = str(input.claim).trim();
  if (!experimentId) throw new Error("observations.add: experimentId must not be empty");
  if (!claim) throw new Error("observations.add: claim (conclusion text) must not be empty");

  const list = read();
  const rec: ObservationRecord = {
    id: str(input.id) || newId(new Set(list.map(r => r.id))),
    experimentId,
    observedAt: str(input.observedAt) || new Date().toISOString(),
    source: input.source,
    claim,
    evidenceText: str(input.evidenceText).trim(),
    confidence: input.confidence,
    author: str(input.author).trim(),
  };
  write([...list, rec]);
  return rec;
}

/** 删除一条；返回是否真的删掉了 */
export function remove(id: string): boolean {
  const list = read();
  const next = list.filter(r => r.id !== id);
  if (next.length === list.length) return false;
  write(next);
  return true;
}

/** 导出全部观测（JSON 文本，时间倒序）；能被 JSON.parse 原样读回 */
export function exportJson(): string {
  return JSON.stringify(loadAll(), null, 2);
}

/** 统计：总数 / 按来源计数 / 按实验计数 */
export function stats(): ObservationStats {
  const list = read();
  const bySource: Record<string, number> = {};
  for (const s of OBSERVATION_SOURCES) bySource[s] = 0;
  const byExperiment: Record<string, number> = {};
  for (const r of list) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    byExperiment[r.experimentId] = (byExperiment[r.experimentId] ?? 0) + 1;
  }
  return { total: list.length, bySource, byExperiment };
}

/** 存储是否真的可用（UI 用它提示「本浏览器不可用，登记只在本会话有效」） */
export function isPersistent(): boolean {
  return !!open() && !storageBroken;
}
