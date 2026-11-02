// Burako rules for two or four players with tiles. Pure state mutations, no DOM.
// Tiles are ids: 0..103 = 2 sets x 4 colors x 1..13, 104..107 = comodines.

export const R = {
  handSize: 11,
  canastaLen: 7,
  canastaLimpia: 200,
  canastaSucia: 100,
  closeBonus: 100,
  muertoPenalty: 100,
  targetScore: 3000,
};

export const JOKERS = [104, 105, 106, 107];
export const color = id => id >= 104 ? 4 : Math.floor((id % 52) / 13);
export const num = id => id >= 104 ? 0 : (id % 13) + 1;
export const isWild = id => id >= 104 || num(id) === 2;
export const value = id => id >= 104 ? 50 : num(id) === 2 ? 20 : num(id) === 1 ? 15 : num(id) >= 8 ? 10 : 5;

function shuffle(a) {
  const r = new Uint32Array(a.length);
  crypto.getRandomValues(r);
  for (let i = a.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Returns {t: ordered ids, w: uses a wild as wild, low: wild sits at the bottom end} or null.
// low picks the end for a wild that could go on either end of a run.
export function validate(ids, low = false) {
  if (ids.length < 3) return null;
  return asSet(ids) ?? asSeq(ids, low);
}

function asSet(ids) {
  if (ids.every(i => i < 104 && num(i) === 2)) return {t: [...ids], w: false};
  const nat = ids.filter(i => !isWild(i)), wild = ids.filter(isWild);
  if (wild.length > 1 || nat.length < 2 || !nat.every(i => num(i) === num(nat[0]))) return null;
  return {t: [...nat.sort((a, b) => color(a) - color(b)), ...wild], w: wild.length > 0};
}

function asSeq(ids, low) {
  const twos = ids.filter(i => i < 104 && num(i) === 2);
  for (let mask = (1 << twos.length) - 1; mask >= 0; mask--) {
    const natTwos = twos.filter((_, k) => mask >> k & 1);
    const nat = ids.filter(i => !isWild(i)).concat(natTwos);
    const wild = ids.filter(i => isWild(i) && !natTwos.includes(i));
    if (wild.length > 1 || !nat.length || !nat.every(i => color(i) === color(nat[0]))) continue;
    for (const aceHigh of [false, true]) {
      const val = i => num(i) === 1 && aceHigh ? 14 : num(i);
      const vs = nat.map(val);
      if (new Set(vs).size !== vs.length) continue;
      const lo = Math.min(...vs), hi = Math.max(...vs), n = ids.length;
      if (hi - lo + 1 - nat.length > wild.length) continue;
      const top = Math.max(1, Math.min(lo, 14 - n + 1)), bottom = Math.max(1, hi - n + 1);
      for (const start of low ? [bottom, top] : [top, bottom]) {
        if (start > lo || start + n - 1 < hi || start + n - 1 > 14 || (aceHigh && start === 1)) continue;
        const out = [], w = [...wild];
        for (let v = start; v < start + n; v++) out.push(nat.find(i => val(i) === v) ?? w.pop());
        const m = {t: out, w: wild.length > 0};
        if (start < lo) m.low = true;
        return m;
      }
    }
  }
  return null;
}

export const isCanasta = m => m.t.length >= R.canastaLen;
// Side of seat p. 2 players: seats 0,1; 2 vs 2: seats 0,2 vs 1,3; free for all (s.ffa): each seat is its own side
export const team = (p, s) => s?.ffa ? p : p % 2;
const seats = s => s.n ?? 2;
export const sides = s => s.ffa ? seats(s) : 2;
const hasCanasta = (s, p) => s.melds[team(p, s)].some(isCanasta);

export function newState(id, player, n = 2, ffa = false) {
  const k = ffa ? n : 2;
  return {schema: 1, id, v: 1, n, ffa, players: [player], phase: 'waiting', turn: 0, round: 0,
    mazo: [], pozo: [], muertos: [], hands: [[], []], melds: Array.from({length: k}, () => []), muerto: Array(k).fill(false),
    snap: null, scores: Array(k).fill(0), last: null, log: ''};
}

// Upgrade states saved by older deploys. Only add fields with defaults here; never rename or drop fields.
export function migrate(s) {
  if (!s || typeof s !== 'object') return s;
  s.n ??= 2;
  s.ffa ??= false;
  s.ev ??= null;
  return s;
}

export function deal(s) {
  const deck = shuffle([...Array(108).keys()]);
  s.hands = Array.from({length: seats(s)}, () => deck.splice(0, R.handSize));
  s.muertos = [deck.splice(0, R.handSize), deck.splice(0, R.handSize)];
  s.pozo = [deck.pop()];
  s.mazo = deck;
  s.melds = Array.from({length: sides(s)}, () => []);
  s.muerto = Array(sides(s)).fill(false);
  s.turn = s.round % seats(s);
  s.round++;
  s.phase = 'draw';
  s.snap = null;
  s.last = null;
  say(s, 'hand {0}', s.round);
}

const name = (s, p) => s.players[p]?.name ?? '?';
// log: English text for older clients; ev: [template, ...args] so each client shows it in its own language
const say = (s, k, ...a) => { s.ev = [k, ...a]; s.log = a.reduce((t, x, i) => t.replace('{' + i + '}', x), k); };
const takeSnap = (s, p) => { s.snap = JSON.stringify({h: s.hands[p], m: s.melds[team(p, s)], k: s.muerto, d: s.muertos}); };

function removeFromHand(s, p, ids) {
  const h = s.hands[p];
  if (!ids.every(i => h.includes(i)) || new Set(ids).size !== ids.length) return false;
  s.hands[p] = h.filter(i => !ids.includes(i));
  return true;
}

function takeMuerto(s, p) {
  s.hands[p] = s.muertos.pop();
  s.muerto[team(p, s)] = true;
  say(s, '{0} took the dead hand', name(s, p));
}

// After melding: an empty hand takes the muerto or closes the round.
function afterMeld(s, p) {
  const stuck = s.muerto[team(p, s)] || !s.muertos.length;
  if (s.hands[p].length === 1 && stuck && !hasCanasta(s, p)) return 'keep a tile: you can\'t go out without a canasta';
  if (s.hands[p].length) return;
  if (!s.muerto[team(p, s)] && s.muertos.length) return takeMuerto(s, p);
  if (!hasCanasta(s, p)) return 'you need a canasta to go out';
  endRound(s, p);
}

export function act(s, p, a) {
  if (a.type === 'next') {
    if (s.phase !== 'over') return 'the hand isn\'t over';
    deal(s); return;
  }
  if (s.turn !== p || (s.phase !== 'draw' && s.phase !== 'play')) return 'not your turn';
  const before = JSON.stringify(s);
  const err = run(s, p, a);
  if (err) Object.assign(s, JSON.parse(before));
  return err;
}

function run(s, p, a) {
  switch (a.type) {
    case 'draw': {
      if (s.phase !== 'draw') return 'you already drew';
      if (!s.mazo.length) {
        if (s.muertos.length) s.mazo = s.muertos.pop();
        else return endRound(s, null);
      }
      s.hands[p].push(s.mazo.pop());
      s.phase = 'play';
      say(s, '{0} drew from the deck', name(s, p));
      return takeSnap(s, p);
    }
    case 'pozo': {
      if (s.phase !== 'draw') return 'you already drew';
      if (!s.pozo.length) return 'the pile is empty';
      say(s, '{0} took the pile ({1})', name(s, p), s.pozo.length);
      s.hands[p].push(...s.pozo);
      s.pozo = [];
      s.phase = 'play';
      return takeSnap(s, p);
    }
    case 'meld': {
      if (s.phase !== 'play') return 'draw first';
      const m = validate(a.ids, a.low);
      if (!m) return 'not a valid meld';
      if (!removeFromHand(s, p, a.ids)) return 'invalid tiles';
      s.melds[team(p, s)].push(m);
      say(s, '{0} laid down a meld', name(s, p));
      return afterMeld(s, p);
    }
    case 'add': {
      if (s.phase !== 'play') return 'draw first';
      const old = s.melds[team(p, s)][a.meld];
      if (!old) return 'invalid meld';
      const m = validate([...old.t, ...a.ids], a.low ?? old.low);
      if (!m) return 'doesn\'t fit that meld';
      if (!removeFromHand(s, p, a.ids)) return 'invalid tiles';
      s.melds[team(p, s)][a.meld] = m;
      say(s, '{0} added to a meld', name(s, p));
      return afterMeld(s, p);
    }
    case 'discard': {
      if (s.phase !== 'play') return 'draw first';
      if (!removeFromHand(s, p, [a.id])) return 'invalid tile';
      s.pozo.push(a.id);
      say(s, '{0} discarded', name(s, p));
      if (!s.hands[p].length) {
        if (!s.muerto[team(p, s)] && s.muertos.length) takeMuerto(s, p);
        else if (hasCanasta(s, p)) return endRound(s, p);
        else return 'you need a canasta to go out';
      }
      s.turn = (p + 1) % seats(s);
      s.phase = 'draw';
      s.snap = null;
      return;
    }
    case 'undo': {
      if (s.phase !== 'play' || !s.snap) return 'nothing to undo';
      const o = JSON.parse(s.snap);
      s.hands[p] = o.h; s.melds[team(p, s)] = o.m; s.muerto = o.k; s.muertos = o.d;
      say(s, '{0} undid', name(s, p));
      return;
    }
  }
  return 'unknown action';
}

// Scores are per side; closer is a seat.
export function endRound(s, closer) {
  s.last = [...Array(sides(s)).keys()].map(p => {
    const juegos = s.melds[p].reduce((a, m) => a + m.t.reduce((b, i) => b + value(i), 0), 0);
    const canastas = s.melds[p].filter(isCanasta).reduce((a, m) => a + (m.w ? R.canastaSucia : R.canastaLimpia), 0);
    const cierre = closer != null && team(closer, s) === p ? R.closeBonus : 0;
    const mano = -s.hands.filter((_, q) => team(q, s) === p).flat().reduce((a, i) => a + value(i), 0);
    // Free for all shares the two dead hands, so not getting one isn't penalized
    const muerto = s.muerto[p] || s.ffa ? 0 : -R.muertoPenalty;
    const total = juegos + canastas + cierre + mano + muerto;
    s.scores[p] += total;
    return {juegos, canastas, cierre, mano, muerto, total};
  });
  s.phase = 'over';
  s.snap = null;
  closer == null ? say(s, 'the deck ran out') : say(s, '{0} went out', name(s, closer));
}
