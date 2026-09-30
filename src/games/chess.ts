/** Event-driven chess domain. No rendering, timer, network or physics dependency.
 * Squares are stable identities: a1 = 0, h8 = 63. Positive pieces are white.
 * Authoring describes the initial position; playing never edits that definition. */
export type Side = 1 | -1;
export type Piece = 0 | 1 | 2 | 3 | 4 | 5 | 6 | -1 | -2 | -3 | -4 | -5 | -6;
export type Promotion = 2 | 3 | 4 | 5;
export interface Position {
  readonly board: readonly Piece[];
  readonly turn: Side;
  readonly castling: number;
  readonly ep: number;
  readonly halfmove: number;
  readonly fullmove: number;
}
export interface Move { readonly from: number; readonly to: number; readonly promotion?: Promotion; }
export interface ChessDefinition { readonly fen: string; readonly historyLimit: number; }
export interface MoveRecord { readonly move: Move; readonly san: string; readonly before: string; readonly after: string; }
export type ChessResult =
  | { readonly kind: 'playing'; readonly check: boolean; readonly canClaim: readonly ('repetition' | 'fifty-move')[] }
  | { readonly kind: 'checkmate'; readonly winner: Side }
  | { readonly kind: 'draw'; readonly reason: 'stalemate' | 'dead-material' | 'fivefold' | 'seventy-five-move' | 'repetition' | 'fifty-move' };
export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const symbols = ' PNBRQK';
const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const knights = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]] as const;
const side = (piece: number): Side => piece > 0 ? 1 : -1;
const inside = (x: number, y: number) => x >= 0 && x < 8 && y >= 0 && y < 8;
const validSquare = (n: number) => Number.isInteger(n) && n >= 0 && n < 64;
export function square(name: string): number {
  if (!/^[a-h][1-8]$/.test(name)) throw new TypeError('Expected a square such as e4');
  return name.charCodeAt(0) - 97 + (Number(name[1]) - 1) * 8;
}
export function squareName(value: number): string {
  if (!validSquare(value)) throw new RangeError('Square must be within 0..63');
  return String.fromCharCode(97 + value % 8) + (Math.floor(value / 8) + 1);
}
export function chess(options: { fen?: string; historyLimit?: number } = {}): ChessDefinition {
  const fen = options.fen ?? INITIAL_FEN, historyLimit = options.historyLimit ?? 2048;
  parsePosition(fen);
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 16384) throw new RangeError('Chess history limit: 1..16384');
  return Object.freeze({ fen, historyLimit });
}
export function parsePosition(fen: string): Position {
  if (typeof fen !== 'string' || fen.length > 200) throw new TypeError('Invalid FEN');
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) throw new TypeError('FEN requires six fields');
  const [placement, turn, rights, ep, halfmove, fullmove] = fields;
  const ranks = placement!.split('/'), board = new Array<Piece>(64).fill(0);
  if (ranks.length !== 8) throw new TypeError('FEN requires eight ranks');
  for (let row = 0; row < 8; row++) {
    let x = 0;
    for (const char of ranks[row]!) {
      if (/^[1-8]$/.test(char)) x += Number(char);
      else {
        const kind = symbols.indexOf(char.toUpperCase());
        if (kind < 1 || x >= 8) throw new TypeError('Unknown FEN piece');
        board[(7 - row) * 8 + x++] = (char === char.toUpperCase() ? kind : -kind) as Piece;
      }
    }
    if (x !== 8) throw new TypeError('A FEN rank must describe eight squares');
  }
  if (turn !== 'w' && turn !== 'b') throw new TypeError('FEN turn must be w or b');
  if (!/^(?:-|K?Q?k?q?)$/.test(rights!) || !rights) throw new TypeError('Invalid castling rights');
  if (!/^\d+$/.test(halfmove!) || !/^[1-9]\d*$/.test(fullmove!)) throw new TypeError('Invalid FEN counters');
  const h = Number(halfmove), f = Number(fullmove);
  if (!Number.isSafeInteger(h) || !Number.isSafeInteger(f)) throw new RangeError('FEN counter overflow');
  if (board.filter(p => p === 6).length !== 1 || board.filter(p => p === -6).length !== 1) throw new TypeError('Each side needs exactly one king');
  if ([...board.slice(0, 8), ...board.slice(56)].some(p => Math.abs(p) === 1)) throw new TypeError('Pawns cannot stand on the first or last rank');
  let castling = 0;
  for (const [letter, bit, king, rook, color] of [['K', 1, 4, 7, 1], ['Q', 2, 4, 0, 1], ['k', 4, 60, 63, -1], ['q', 8, 60, 56, -1]] as const) {
    if (rights!.includes(letter)) {
      if (board[king] !== color * 6 || board[rook] !== color * 4) throw new TypeError('Castling right requires its original king and rook');
      castling |= bit;
    }
  }
  const color: Side = turn === 'w' ? 1 : -1, target = ep === '-' ? -1 : square(ep!);
  if (target >= 0 && (Math.floor(target / 8) !== (color === 1 ? 5 : 2) || board[target] !== 0 || board[target - color * 8] !== -color || board[target + color * 8] !== 0)) throw new TypeError('Invalid en passant target');
  const position = freeze({ board, turn: color, castling, ep: target, halfmove: h, fullmove: f });
  // The side that just moved cannot leave its own king attacked. The side to move may be in check.
  if (inCheck(position, color === 1 ? -1 : 1)) throw new TypeError('FEN leaves the previous mover in check');
  return position;
}
function freeze(position: Position): Position { return Object.freeze({ ...position, board: Object.freeze(position.board) }); }
export function positionFEN(p: Position): string {
  const rows: string[] = [];
  for (let y = 7; y >= 0; y--) {
    let row = '', empty = 0;
    for (let x = 0; x < 8; x++) {
      const piece = p.board[y * 8 + x]!;
      if (!piece) empty++;
      else { if (empty) row += empty; empty = 0; const c = symbols[Math.abs(piece)]!; row += piece > 0 ? c : c.toLowerCase(); }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const rights = [...'KQkq'].filter((_, i) => p.castling & (1 << i)).join('') || '-';
  return `${rows.join('/')} ${p.turn === 1 ? 'w' : 'b'} ${rights} ${p.ep < 0 ? '-' : squareName(p.ep)} ${p.halfmove} ${p.fullmove}`;
}
export function attacked(p: Position, target: number, by: Side): boolean {
  const x = target % 8, y = Math.floor(target / 8), b = p.board;
  for (const dx of [-1, 1]) if (inside(x + dx, y - by) && b[(y - by) * 8 + x + dx] === by) return true;
  for (const [dx, dy] of knights) if (inside(x + dx, y + dy) && b[(y + dy) * 8 + x + dx] === by * 2) return true;
  for (let d = 0; d < directions.length; d++) {
    const [dx, dy] = directions[d]!;
    for (let distance = 1; ; distance++) {
      const nx = x + dx * distance, ny = y + dy * distance;
      if (!inside(nx, ny)) break;
      const piece = b[ny * 8 + nx]!;
      if (!piece) continue;
      if (side(piece) === by && (Math.abs(piece) === 5 || Math.abs(piece) === (d < 4 ? 4 : 3) || distance === 1 && Math.abs(piece) === 6)) return true;
      break;
    }
  }
  return false;
}
export function inCheck(p: Position, color: Side = p.turn): boolean {
  const king = p.board.indexOf((color * 6) as Piece);
  return king < 0 || attacked(p, king, color === 1 ? -1 : 1);
}
function pseudo(p: Position): Move[] {
  const out: Move[] = [], b = p.board, color = p.turn;
  const add = (from: number, to: number) => {
    if (Math.abs(b[from]!) === 1 && (to < 8 || to >= 56)) for (const promotion of [5, 4, 3, 2] as const) out.push({ from, to, promotion });
    else out.push({ from, to });
  };
  for (let from = 0; from < 64; from++) {
    const piece = b[from]!;
    if (!piece || side(piece) !== color) continue;
    const kind = Math.abs(piece), x = from % 8, y = Math.floor(from / 8);
    if (kind === 1) {
      const forward = from + color * 8;
      if (validSquare(forward) && !b[forward]) {
        add(from, forward);
        if (y === (color === 1 ? 1 : 6) && !b[from + color * 16]) add(from, from + color * 16);
      }
      for (const dx of [-1, 1]) if (inside(x + dx, y + color)) {
        const to = (y + color) * 8 + x + dx, victim = b[to]!;
        if (victim && side(victim) !== color && Math.abs(victim) !== 6 || to === p.ep && b[to - color * 8] === -color) add(from, to);
      }
    } else if (kind === 2 || kind === 6) {
      for (const [dx, dy] of kind === 2 ? knights : directions) if (inside(x + dx, y + dy)) {
        const to = (y + dy) * 8 + x + dx, victim = b[to]!;
        if (!victim || side(victim) !== color && Math.abs(victim) !== 6) add(from, to);
      }
      const home = color === 1 ? 4 : 60;
      if (kind === 6 && from === home && !inCheck(p)) {
        const shift = color === 1 ? 0 : 2, enemy: Side = color === 1 ? -1 : 1;
        if (p.castling & (1 << shift) && b[home + 3] === color * 4 && !b[home + 1] && !b[home + 2] && !attacked(p, home + 1, enemy) && !attacked(p, home + 2, enemy)) add(from, home + 2);
        if (p.castling & (2 << shift) && b[home - 4] === color * 4 && !b[home - 1] && !b[home - 2] && !b[home - 3] && !attacked(p, home - 1, enemy) && !attacked(p, home - 2, enemy)) add(from, home - 2);
      }
    } else {
      for (let d = 0; d < directions.length; d++) {
        if (kind === 3 && d < 4 || kind === 4 && d >= 4) continue;
        const [dx, dy] = directions[d]!;
        for (let n = 1; inside(x + n * dx, y + n * dy); n++) {
          const to = (y + n * dy) * 8 + x + n * dx, victim = b[to]!;
          if (victim && side(victim) === color || Math.abs(victim) === 6) break;
          add(from, to); if (victim) break;
        }
      }
    }
  }
  return out;
}
function apply(p: Position, move: Move): Position {
  const board = [...p.board], piece = board[move.from]!, captured = board[move.to]!, color = p.turn;
  board[move.from] = 0; board[move.to] = move.promotion ? (move.promotion * color) as Piece : piece;
  if (Math.abs(piece) === 1 && move.to === p.ep && !captured) board[move.to - color * 8] = 0;
  let castling = p.castling;
  if (Math.abs(piece) === 6) {
    castling &= color === 1 ? ~3 : ~12;
    if (Math.abs(move.to - move.from) === 2) {
      const kingSide = move.to > move.from, rookFrom = move.from + (kingSide ? 3 : -4), rookTo = move.from + (kingSide ? 1 : -1);
      board[rookTo] = board[rookFrom]!; board[rookFrom] = 0;
    }
  }
  for (const [s, bit] of [[7, 1], [0, 2], [63, 4], [56, 8]] as const) if (move.from === s || move.to === s) castling &= ~bit;
  return freeze({ board, turn: color === 1 ? -1 : 1, castling, ep: Math.abs(piece) === 1 && Math.abs(move.to - move.from) === 16 ? (move.from + move.to) / 2 : -1, halfmove: Math.abs(piece) === 1 || captured ? 0 : p.halfmove + 1, fullmove: p.fullmove + (color === -1 ? 1 : 0) });
}
export function legalMoves(p: Position, from?: number): readonly Move[] {
  if (from !== undefined && !validSquare(from)) throw new RangeError('Invalid source square');
  return pseudo(p).filter(m => (from === undefined || m.from === from) && !inCheck(apply(p, m), p.turn));
}
export function play(p: Position, move: Move): Position {
  if (!validSquare(move.from) || !validSquare(move.to)) throw new RangeError('Invalid move squares');
  const legal = legalMoves(p, move.from).find(m => m.to === move.to && m.promotion === move.promotion);
  if (!legal) throw new TypeError('Illegal move (promotion must be explicit)');
  return apply(p, legal);
}
export function perft(p: Position, depth: number): number {
  if (!Number.isInteger(depth) || depth < 0 || depth > 5) throw new RangeError('Perft depth: 0..5');
  if (!depth) return 1;
  let nodes = 0; for (const m of legalMoves(p)) nodes += perft(apply(p, m), depth - 1); return nodes;
}
function deadMaterial(p: Position): boolean {
  const minor: number[] = [];
  for (let s = 0; s < 64; s++) { const k = Math.abs(p.board[s]!); if (k && k !== 6) { if (k !== 2 && k !== 3) return false; minor.push(s); } }
  if (minor.length <= 1) return true;
  return minor.every(s => Math.abs(p.board[s]!) === 3 && (s % 8 + Math.floor(s / 8)) % 2 === (minor[0]! % 8 + Math.floor(minor[0]! / 8)) % 2);
}
export function positionKey(p: Position): string {
  // A nominal FEN EP square changes repetition identity only when that capture is legal.
  const fields = positionFEN(p).split(' ');
  if (p.ep >= 0 && !legalMoves(p).some(m => m.to === p.ep && Math.abs(p.board[m.from]!) === 1)) fields[3] = '-';
  return fields.slice(0, 4).join(' ');
}
export function chessResult(p: Position, repetitions = 1): ChessResult {
  const check = inCheck(p);
  if (!legalMoves(p).length) return check ? { kind: 'checkmate', winner: p.turn === 1 ? -1 : 1 } : { kind: 'draw', reason: 'stalemate' };
  if (deadMaterial(p)) return { kind: 'draw', reason: 'dead-material' };
  if (p.halfmove >= 150) return { kind: 'draw', reason: 'seventy-five-move' };
  if (repetitions >= 5) return { kind: 'draw', reason: 'fivefold' };
  const canClaim: ('repetition' | 'fifty-move')[] = [];
  if (repetitions >= 3) canClaim.push('repetition'); if (p.halfmove >= 100) canClaim.push('fifty-move');
  return { kind: 'playing', check, canClaim };
}
function notation(before: Position, move: Move, after: Position): string {
  const piece = Math.abs(before.board[move.from]!);
  let text: string;
  if (piece === 6 && Math.abs(move.to - move.from) === 2) text = move.to > move.from ? 'O-O' : 'O-O-O';
  else {
    const capture = !!before.board[move.to] || piece === 1 && move.to === before.ep;
    let disambiguate = '';
    if (piece !== 1) {
      const others = legalMoves(before).filter(m => m.from !== move.from && m.to === move.to && before.board[m.from] === before.board[move.from]);
      if (others.length) disambiguate = !others.some(m => m.from % 8 === move.from % 8) ? squareName(move.from)[0]! : !others.some(m => Math.floor(m.from / 8) === Math.floor(move.from / 8)) ? squareName(move.from)[1]! : squareName(move.from);
    }
    text = (piece === 1 ? capture ? squareName(move.from)[0] : '' : symbols[piece]) + disambiguate + (capture ? 'x' : '') + squareName(move.to) + (move.promotion ? '=' + symbols[move.promotion] : '');
  }
  if (inCheck(after)) text += legalMoves(after).length ? '+' : '#';
  return text;
}
/** A bounded match. Inspect and undo are event-driven, never scheduled per render frame. */
export class Chess {
  private states: Position[];
  private records: MoveRecord[] = [];
  private claimed: ChessResult | undefined;
  private readonly repetitions = new Map<string, number>();
  private cachedResult: ChessResult | undefined;
  readonly definition: ChessDefinition;
  constructor(input: ChessDefinition = chess()) { this.definition = chess(input); this.states = [parsePosition(this.definition.fen)]; this.repetitions.set(positionKey(this.position), 1); }
  get position(): Position { return this.states[this.states.length - 1]!; }
  get history(): readonly MoveRecord[] { return this.records.slice(); }
  get result(): ChessResult {
    if (this.claimed) return this.claimed;
    if (!this.cachedResult) { const result = chessResult(this.position, this.repetitions.get(positionKey(this.position)) ?? 0); this.cachedResult = Object.freeze(result.kind === 'playing' ? { ...result, canClaim: Object.freeze([...result.canClaim]) } : result); }
    return this.cachedResult;
  }
  move(move: Move): MoveRecord {
    if (this.result.kind !== 'playing') throw new Error('Match has ended');
    if (this.records.length >= this.definition.historyLimit) throw new RangeError('Match history budget reached');
    const before = this.position, after = play(before, move), record = Object.freeze({ move: Object.freeze({ ...move }), san: notation(before, move, after), before: positionFEN(before), after: positionFEN(after) });
    this.states.push(after); this.records.push(record); const key = positionKey(after); this.repetitions.set(key, (this.repetitions.get(key) ?? 0) + 1); this.cachedResult = undefined; return record;
  }
  undo(): boolean { if (!this.records.length) return false; const key = positionKey(this.position), count = this.repetitions.get(key)!; if (count > 1) this.repetitions.set(key, count - 1); else this.repetitions.delete(key); this.states.pop(); this.records.pop(); this.claimed = undefined; this.cachedResult = undefined; return true; }
  claimDraw(reason: 'repetition' | 'fifty-move'): void {
    const result = this.result;
    if (result.kind !== 'playing' || !result.canClaim.includes(reason)) throw new Error('Draw cannot be claimed');
    this.claimed = Object.freeze({ kind: 'draw', reason });
  }
  dispose(): void { this.records = []; this.states = [parsePosition(this.definition.fen)]; this.claimed = undefined; this.cachedResult = undefined; this.repetitions.clear(); this.repetitions.set(positionKey(this.position), 1); }
}
