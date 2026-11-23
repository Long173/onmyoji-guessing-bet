// kernel/evidence.ts — 规则证据登记表
// 每条规则都必须标来源等级；来源等级决定它能被用在哪。
export type EvidenceSource =
  | "OFFICIAL_TOOLTIP"   // 游戏内 tooltip 原文（最高）
  | "SPEC_DOC"           // 《回合结算过程3.0》等社区规格书
  | "DATA_CENSUS"        // 对全量数据统计得出
  | "USER_CONFIRMED"     // 领域用户直接确认（本项目内视为权威）
  | "COMMUNITY"          // 攻略/帖子
  | "UNVERIFIED";        // 未验证，禁止用于产出结论

export interface VerifiedRule {
  id: string;
  statement: string;
  value: unknown;
  source: EvidenceSource;
  /** 来源出处，可复核 */
  origin: string;
  confirmedAt: string;
  /** 该规则替代/关闭了哪些此前的假设或待实测项 */
  supersedes?: string[];
  note?: string;
}

export const VERIFIED_RULES: VerifiedRule[] = [
  {
    id: "GUESSING_NO_ONMYOJI",
    statement: "对弈竞猜环境下不存在阴阳师（不占队伍位，也不会出现在双方阵容中）",
    value: { hasOnmyoji: false, teamSize: 5 },
    source: "USER_CONFIRMED",
    origin: "用户在会话中直接确认：『对弈竞猜环境下没有阴阳师，所以不需要。』",
    confirmedAt: new Date().toISOString(),
    supersedes: [
      "D 组待核实项：对弈竞猜是否含阴阳师（此前证据冲突：duel-panels 679 条 / duiyi 240 条中阴阳师 0 次，但对弈百科 AI 描述出现『除阴阳师』）",
      "阴阳师面板缺口（本项目主线不再需要阴阳师面板）",
      "御灵成长数据缺口（同上）",
      "源赖光/藤原道长面板三源互斥问题（同上）",
    ],
    note: "该规则把整条『阴阳师本体数据』支线移出主线；相关基础设施保留但不在关键路径上。",
  },
];

export const RuleIndex = new Map(VERIFIED_RULES.map(r => [r.id, r]));

/** 供运行期强制校验使用 */
export function guessingHasOnmyoji(): boolean {
  return (RuleIndex.get("GUESSING_NO_ONMYOJI")!.value as { hasOnmyoji: boolean }).hasOnmyoji;
}
