/** Вычислительная модель переживаний, не утверждение о наличии сознания.
 * Только authority подаёт воспринятые исходы. Решение/реплика сами не дают награду.
 * Время — секунды симуляции; нет Date.now, Math.random, LLM или зависимости от renderer. */
export const LIFE_AXES = ['comfort', 'connection', 'autonomy', 'mastery', 'meaning'] as const;
export type LifeAxis = typeof LIFE_AXES[number];
export type LifeVector = Readonly<Record<LifeAxis, number>>;
export const LIFE_LIMITS = Object.freeze({ memories: 64, expectations: 64, beliefs: 48, evidence: 8, context: 8, opportunities: 32 });
export interface LifeProfile { readonly values: LifeVector; readonly curiosity: number; readonly riskTolerance: number }
export interface LifeProfileOptions {
  readonly values?: Readonly<Partial<LifeVector>>; readonly curiosity?: number; readonly riskTolerance?: number;
}
export interface LifeEvidence {
  readonly claim: string;
  readonly value: boolean;
  readonly kind: 'observation' | 'testimony' | 'inference';
  readonly source: string;
  /** Идентификатор первичного свидетельства, а не пересказчика. */
  readonly origin: string;
  readonly confidence: number;
}
export interface LifeExperienceDetails {
  readonly activity: string;
  readonly context: readonly string[];
  readonly impact: Readonly<Partial<LifeVector>>;
  readonly evidence?: readonly LifeEvidence[];
  /** Воображаемая альтернатива: не добавляется в знания как произошедший факт. */
  readonly counterfactual?: { readonly expectedValue: number; readonly confidence: number };
}
export interface LifeExperience extends LifeExperienceDetails {
  readonly id: string; readonly sequence: number; readonly atS: number; readonly certainty: number;
}
export interface LifeMemory {
  readonly event: LifeExperience;
  readonly value: number;
  readonly novelty: number;
  readonly gratitude: number;
  readonly regret: number;
}
export interface LifeExpectation {
  readonly activity: string; readonly context: readonly string[];
  readonly value: number; readonly weight: number; readonly visits: number; readonly atS: number;
}
export interface LifeBelief { readonly claim: string; readonly evidence: readonly LifeEvidence[]; readonly atS: number }
export interface LifeState {
  readonly version: 1; readonly actorId: string; readonly atS: number; readonly lastSequence: number;
  readonly profile: LifeProfile;
  readonly fulfilment: LifeVector;
  readonly feeling: { readonly pleasure: number; readonly atS: number };
  readonly memories: readonly LifeMemory[];
  readonly expectations: readonly LifeExpectation[];
  readonly beliefs: readonly LifeBelief[];
}
export interface LifeOpportunity {
  readonly id: string; readonly activity: string; readonly available: boolean;
  readonly essential: boolean; readonly expiresAtS: number;
  readonly requirements: readonly string[];
  readonly anticipated: Readonly<Partial<LifeVector>>;
  readonly cost: number; readonly risk: number;
}
export interface LifeSituation {
  readonly atS: number; readonly context: readonly string[]; readonly budget: number; readonly emergency: boolean;
}
export interface LifeChoice {
  readonly selected: string | null;
  readonly ranked: readonly { readonly id: string; readonly score: number; readonly expected: number; readonly exploration: number }[];
  readonly rejected: readonly { readonly id: string; readonly reason: 'unavailable' | 'expired' | 'conditions' | 'budget' | 'risk' | 'emergency' }[];
}
const clamp = (n: number, lo = -1, hi = 1): number => Math.max(lo, Math.min(hi, n));
const order = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const vector = (n: number): Record<LifeAxis, number> => ({ comfort: n, connection: n, autonomy: n, mastery: n, meaning: n });
function id(s: string): void { if (typeof s !== 'string' || !s.trim() || s.length > 160) throw new TypeError('Invalid life ID'); }
function range(n: number, lo = 0, hi = 1): void { if (!Number.isFinite(n) || n < lo || n > hi) throw new RangeError('Life value out of range'); }
function time(n: number): void { range(n, 0, Number.MAX_SAFE_INTEGER); }
function sequence(n: number, min = 1): void { if (!Number.isSafeInteger(n) || n < min) throw new RangeError('Invalid life sequence'); }
function array<T>(a: readonly T[], max: number): void { if (!Array.isArray(a) || a.length > max) throw new RangeError('Life budget exceeded'); }
function tags(a: readonly string[]): string[] {
  array(a, LIFE_LIMITS.context); for (const s of a) id(s);
  if (new Set(a).size !== a.length) throw new TypeError('Duplicate life context');
  return [...a].sort(order);
}
function impact(v: Readonly<Partial<LifeVector>>, full = false, min = -1): void {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError('Invalid life vector');
  for (const [k, n] of Object.entries(v)) {
    if (!LIFE_AXES.includes(k as LifeAxis)) throw new TypeError('Unknown life axis');
    range(n as number, min);
  }
  if (full) for (const k of LIFE_AXES) range(v[k] as number, min);
}
function evidence(e: LifeEvidence): void {
  id(e.claim); id(e.source); id(e.origin); range(e.confidence);
  if (typeof e.value !== 'boolean' || !['observation', 'testimony', 'inference'].includes(e.kind)) throw new TypeError('Invalid life evidence');
}
function clock(state: LifeState, atS: number): void { time(atS); if (atS < state.atS) throw new RangeError('Life clock moved backwards'); }
const key = (activity: string, context: readonly string[]): string => JSON.stringify([activity, context]);
function subjective(state: LifeState, v: Readonly<Partial<LifeVector>>): number {
  return clamp(LIFE_AXES.reduce((sum, axis) => sum + state.profile.values[axis] * (v[axis] ?? 0), 0));
}
export function createLifeState(actorId: string, options: LifeProfileOptions = {}, atS = 0): LifeState {
  id(actorId); time(atS);
  const values = { ...vector(0), ...(options.values ?? vector(1)) };
  impact(values, true, 0);
  const total = LIFE_AXES.reduce((s, a) => s + values[a], 0);
  if (total <= 0) throw new RangeError('Life values must have positive weight');
  for (const axis of LIFE_AXES) values[axis] /= total;
  const curiosity = options.curiosity ?? .5, riskTolerance = options.riskTolerance ?? .35;
  range(curiosity); range(riskTolerance);
  return { version: 1, actorId, atS, lastSequence: 0, profile: { values, curiosity, riskTolerance },
    fulfilment: vector(0), feeling: { pleasure: 0, atS }, memories: [], expectations: [], beliefs: [] };
}
export function validateLifeExperience(e: LifeExperience): void {
  id(e.id); id(e.activity); sequence(e.sequence); time(e.atS); range(e.certainty); tags(e.context); impact(e.impact);
  array(e.evidence ?? [], LIFE_LIMITS.evidence);
  const seen = new Set<string>();
  for (const item of e.evidence ?? []) {
    evidence(item); const k = JSON.stringify([item.claim, item.origin]);
    if (seen.has(k)) throw new TypeError('Duplicate evidence origin for claim'); seen.add(k);
  }
  if (e.counterfactual) { range(e.counterfactual.expectedValue, -1); range(e.counterfactual.confidence); }
}
/** Сиюминутное удовольствие затухает; прожитая удовлетворённость не исчезает при LOD/unload. */
export function lifeWellbeingAt(state: LifeState, atS: number): { pleasure: number; satisfaction: number; meaning: number } {
  clock(state, atS);
  return { pleasure: state.feeling.pleasure * Math.exp(-(atS - state.feeling.atS) / 300),
    satisfaction: clamp(.5 + subjective(state, state.fulfilment) * .5, 0, 1), meaning: clamp(.5 + state.fulfilment.meaning * .5, 0, 1) };
}
function learnExpectation(old: LifeExpectation | undefined, e: LifeExperience, context: readonly string[], value: number): LifeExpectation {
  const previousWeight = old?.weight ?? 0, weight = previousWeight + e.certainty;
  return { activity: e.activity, context: [...context], value: clamp(((old?.value ?? 0) * previousWeight + value * e.certainty) / weight),
    weight: Math.min(32, weight), visits: Math.min(1_000_000, (old?.visits ?? 0) + 1), atS: e.atS };
}
/** Чистый атомарный reducer. Повторы sequence не дают ни счастья, ни новых доказательств.
 * Для повторного ID после вытеснения памяти authority обязан сохранять исходный sequence. */
export function liveExperience(state: LifeState, input: LifeExperience): LifeState {
  validateLifeExperience(input);
  if (input.sequence <= state.lastSequence) return state;
  clock(state, input.atS);
  if (state.memories.some(m => m.event.id === input.id)) return { ...state, atS: input.atS, lastSequence: input.sequence };
  const e: LifeExperience = { ...structuredClone(input), context: tags(input.context) };
  const base = state.expectations.find(b => b.activity === e.activity && b.context.length === 0);
  const novelty = 1 / Math.sqrt(1 + (base?.visits ?? 0));
  // Новые ID на том же тике не позволяют бесконечно фармить удовольствие.
  const recovery = base ? -Math.expm1(-(e.atS - base.atS) / 60) : 1;
  const value = subjective(state, e.impact), rate = .12 * e.certainty * recovery;
  const fulfilment = { ...state.fulfilment };
  for (const axis of LIFE_AXES) if (e.impact[axis] !== undefined) fulfilment[axis] = clamp(fulfilment[axis] + rate * (e.impact[axis]! - fulfilment[axis]));
  const hasImpact = Object.keys(e.impact).length > 0;
  const previousPleasure = lifeWellbeingAt(state, e.atS).pleasure;
  const pleasure = clamp(previousPleasure + (value - previousPleasure) * e.certainty * recovery * (.25 + .5 * novelty));
  let expectations = [...state.expectations];
  if (hasImpact && e.certainty > 0) for (const context of e.context.length ? [[], e.context] : [[]]) {
    const k = key(e.activity, context), old = expectations.find(b => key(b.activity, b.context) === k);
    expectations = expectations.filter(b => key(b.activity, b.context) !== k);
    expectations.push(learnExpectation(old, e, context, value));
  }
  expectations.sort((a, b) => b.atS - a.atS || order(key(a.activity, a.context), key(b.activity, b.context)));
  let beliefs = [...state.beliefs];
  for (const item of [...(e.evidence ?? [])].sort((a, b) => order(a.claim, b.claim) || order(a.origin, b.origin))) {
    const adjusted = { ...item, confidence: item.confidence * e.certainty };
    if (adjusted.confidence === 0) continue;
    const old = beliefs.find(b => b.claim === item.claim), prior = old?.evidence.find(x => x.origin === item.origin);
    // Один первичный источник нельзя превратить в восемь независимых пересказами.
    const strength = (x: LifeEvidence): number => x.confidence * (x.kind === 'observation' ? 1 : x.kind === 'testimony' ? .3 : .1);
    if (prior && (strength(prior) > strength(adjusted) || strength(prior) === strength(adjusted) && prior.value === adjusted.value)) continue;
    const items = [...(old?.evidence ?? []).filter(x => x.origin !== item.origin), adjusted].slice(-LIFE_LIMITS.evidence);
    beliefs = beliefs.filter(b => b.claim !== item.claim);
    beliefs.push({ claim: item.claim, evidence: items, atS: e.atS });
  }
  beliefs.sort((a, b) => b.atS - a.atS || order(a.claim, b.claim));
  const difference = e.counterfactual ? (value - e.counterfactual.expectedValue) * e.counterfactual.confidence * e.certainty / 2 : 0;
  const memory: LifeMemory = { event: e, value, novelty, gratitude: Math.max(0, difference), regret: Math.max(0, -difference) };
  return { ...state, atS: e.atS, lastSequence: e.sequence, fulfilment,
    feeling: hasImpact ? { pleasure, atS: e.atS } : state.feeling,
    expectations: expectations.slice(0, LIFE_LIMITS.expectations), beliefs: beliefs.slice(0, LIFE_LIMITS.beliefs),
    memories: [memory, ...state.memories].slice(0, LIFE_LIMITS.memories) };
}
/** Уверенность — субъективная оценка с prior Beta(1,1), а не доступ к истине мира. */
export function lifeBeliefProbability(state: LifeState, claim: string): number {
  id(claim); let yes = 1, no = 1;
  for (const e of state.beliefs.find(b => b.claim === claim)?.evidence ?? []) {
    const w = e.confidence * (e.kind === 'observation' ? 1 : e.kind === 'testimony' ? .3 : .1);
    if (e.value) yes += w; else no += w;
  }
  return yes / (yes + no);
}
/** «Знание» = поддержанное наблюдениями рабочее заключение; при конфликте отзывается.
 * Для универсальных законов/причинности authority должен передавать отдельные проверки,
 * а не интерпретировать совместную встречаемость событий как причинное доказательство. */
export function lifeKnowledge(state: LifeState): readonly { claim: string; value: boolean; confidence: number; origins: readonly string[] }[] {
  const result = [];
  for (const b of state.beliefs) {
    const direct = b.evidence.filter(e => e.kind === 'observation' && e.confidence > 0);
    for (const value of [true, false]) {
      const support = direct.filter(e => e.value === value), opposition = direct.filter(e => e.value !== value);
      const weight = support.reduce((sum, e) => sum + e.confidence, 0);
      if (support.length >= 3 && weight >= 2.5 && opposition.length === 0) result.push({ claim: b.claim, value,
        confidence: (1 + weight) / (2 + weight), origins: support.map(e => e.origin).sort(order) });
    }
  }
  return result.sort((a, b) => order(a.claim, b.claim));
}
/** Выбор использует только воспринятые возможности. Не меняет состояние и не выдаёт награду. */
export function chooseLifeOpportunity(state: LifeState, candidates: readonly LifeOpportunity[], situation: LifeSituation): LifeChoice {
  clock(state, situation.atS); const context = tags(situation.context); range(situation.budget);
  if (typeof situation.emergency !== 'boolean') throw new TypeError('Invalid life emergency');
  array(candidates, LIFE_LIMITS.opportunities);
  const seen = new Set<string>(), ranked: LifeChoice['ranked'][number][] = [], rejected: LifeChoice['rejected'][number][] = [];
  for (const c of candidates) {
    id(c.id); id(c.activity); tags(c.requirements); impact(c.anticipated); time(c.expiresAtS); range(c.cost); range(c.risk);
    if (seen.has(c.id) || typeof c.available !== 'boolean' || typeof c.essential !== 'boolean') throw new TypeError('Invalid life opportunity'); seen.add(c.id);
    const reason = !c.available ? 'unavailable' : c.expiresAtS <= situation.atS ? 'expired'
      : !c.requirements.every(t => context.includes(t)) ? 'conditions' : c.cost > situation.budget ? 'budget'
      : c.risk > state.profile.riskTolerance ? 'risk' : situation.emergency && !c.essential ? 'emergency' : null;
    if (reason) { rejected.push({ id: c.id, reason }); continue; }
    const learned = state.expectations.filter(b => b.activity === c.activity && b.context.every(t => context.includes(t)))
      .sort((a, b) => b.context.length - a.context.length || b.weight - a.weight || order(key(a.activity, a.context), key(b.activity, b.context)))[0];
    const base = state.expectations.find(b => b.activity === c.activity && b.context.length === 0);
    const confidence = learned ? learned.weight / (learned.weight + 4) : 0;
    const expected = subjective(state, c.anticipated) * (1 - confidence) + (learned?.value ?? 0) * confidence;
    const exploration = .25 * state.profile.curiosity / Math.sqrt(1 + (base?.visits ?? 0));
    const score = expected + exploration - c.cost * .3 - c.risk * .4;
    ranked.push({ id: c.id, score, expected, exploration });
  }
  ranked.sort((a, b) => b.score - a.score || order(a.id, b.id)); rejected.sort((a, b) => order(a.id, b.id));
  return { selected: ranked[0] && ranked[0].score > 0 ? ranked[0].id : null, ranked, rejected };
}
/** При загрузке сохранения: bounded JSON, конечные числа, ссылки и монотонные часы. */
export function validateLifeState(state: LifeState): void {
  if (!state || state.version !== 1) throw new TypeError('Unsupported life state');
  id(state.actorId); time(state.atS); sequence(state.lastSequence, 0);
  impact(state.profile.values, true, 0); range(state.profile.curiosity); range(state.profile.riskTolerance);
  if (Math.abs(LIFE_AXES.reduce((s, a) => s + state.profile.values[a], 0) - 1) > 1e-10) throw new TypeError('Life values not normalized');
  impact(state.fulfilment, true); range(state.feeling.pleasure, -1); time(state.feeling.atS);
  if (state.feeling.atS > state.atS) throw new RangeError('Future life feeling');
  array(state.memories, LIFE_LIMITS.memories); array(state.expectations, LIFE_LIMITS.expectations); array(state.beliefs, LIFE_LIMITS.beliefs);
  const ids = new Set<string>(), seqs = new Set<number>(), patterns = new Set<string>(), claims = new Set<string>();
  for (const m of state.memories) {
    validateLifeExperience(m.event); range(m.value, -1); range(m.novelty); range(m.gratitude); range(m.regret);
    if (m.event.atS > state.atS || m.event.sequence > state.lastSequence || ids.has(m.event.id) || seqs.has(m.event.sequence)) throw new TypeError('Invalid saved life memory');
    ids.add(m.event.id); seqs.add(m.event.sequence);
  }
  for (const b of state.expectations) {
    id(b.activity); const k = key(b.activity, tags(b.context)); range(b.value, -1); range(b.weight, Number.MIN_VALUE, 32); sequence(b.visits); range(b.visits, 1, 1_000_000); time(b.atS);
    if (b.atS > state.atS || patterns.has(k) || JSON.stringify(b.context) !== JSON.stringify(tags(b.context))) throw new TypeError('Invalid saved life expectation'); patterns.add(k);
  }
  for (const b of state.beliefs) {
    id(b.claim); time(b.atS); array(b.evidence, LIFE_LIMITS.evidence); const origins = new Set<string>();
    if (!b.evidence.length || b.atS > state.atS || claims.has(b.claim)) throw new TypeError('Invalid saved life belief'); claims.add(b.claim);
    for (const e of b.evidence) { evidence(e); if (e.claim !== b.claim || origins.has(e.origin)) throw new TypeError('Invalid saved life evidence'); origins.add(e.origin); }
  }
}
