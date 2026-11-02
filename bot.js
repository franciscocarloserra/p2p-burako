// Rule-based bot. botStep returns the next action for seat p using only what that seat can see.
import {R, validate, isWild, color, num, value, team, isCanasta} from './game.js?v=2026-10-30.8';

export const B = {
  pozoMinGain: 1,      // take the pozo if it lets us lay down at least this many more tiles
  pozoWildGain: 1,     // each wild in the pozo counts as this many layable tiles
  pozoDeny: 0.5,       // each pozo tile that fits the rival's melds counts this much toward taking it
  wildNewMeldHand: 5,  // only start a meld with a wild when holding more than this many tiles
  dumpWildsHand: 3,    // with this many tiles or fewer, wilds go anywhere (they cost points in hand)
  feedRival: 6,        // discard cost per tile the pozo would let the rival lay down
  canastaThreat: 10,   // extra discard cost when the tile grows a rival meld to canasta length
  mistake: 0,          // chance per decision of ignoring the pozo or discarding at random (difficulty)
};
// Difficulty levels as mistake rates
export const LEVELS = {easy: 0.5, normal: 0.2, hard: 0};

const nat = h => h.filter(i => !isWild(i));
// Jokers first: they cost more if caught in hand, and 2s may still serve as naturals in runs
const wilds = h => h.filter(isWild).sort((a, b) => b - a);

// Natural runs and sets of 3+, then pairs completed with one wild.
export function findMeld(hand, allowWild) {
  const n = nat(hand);
  for (let c = 0; c < 4; c++) {
    const byVal = new Map();
    for (const i of hand.filter(i => i < 104 && color(i) === c)) {
      byVal.set(num(i), byVal.get(num(i)) ?? i);
      if (num(i) === 1) byVal.set(14, byVal.get(14) ?? i);
    }
    let run = [];
    for (let v = 1; v <= 15; v++) {
      if (byVal.has(v) && !(v === 14 && run.length && byVal.get(1) === run[0])) { run.push(byVal.get(v)); continue; }
      if (run.length >= 3 && validate(run)) return run;
      run = byVal.has(v) ? [byVal.get(v)] : [];
    }
  }
  const byNum = new Map();
  for (const i of n) byNum.set(num(i), [...(byNum.get(num(i)) ?? []), i]);
  for (const g of byNum.values()) if (g.length >= 3 && validate(g)) return g;
  if (!allowWild || !wilds(hand).length) return null;
  const w = wilds(hand)[0];
  for (const a of n) for (const b of n) {
    if (a >= b) continue;
    const m = [a, b, w];
    if (validate(m)) return m;
  }
  return null;
}

// Natural adds keep the meld clean (a 2 only goes in as its own number); a wild only completes a canasta or gets dumped.
function findAdd(hand, melds) {
  for (const i of hand) for (let k = 0; k < melds.length; k++) {
    const r = i < 104 && validate([...melds[k].t, i], melds[k].low);
    if (r && r.w === melds[k].w) return {type: 'add', meld: k, ids: [i]};
  }
  const dump = hand.length <= B.dumpWildsHand;
  for (const i of wilds(hand)) for (let k = 0; k < melds.length; k++) {
    const m = melds[k];
    if (!m.w && !isCanasta(m) && (dump || m.t.length === R.canastaLen - 1) && validate([...m.t, i], m.low)) return {type: 'add', meld: k, ids: [i]};
  }
  return null;
}

// How many tiles a hand could lay down greedily (used to value the pozo).
function layable(hand, melds) {
  let h = [...hand], n = 0, ms = melds.map(m => ({...m}));
  for (let guard = 0; guard < 30; guard++) {
    const a = findAdd(h, ms);
    const m = a ? null : findMeld(h, false);
    const ids = a ? a.ids : m;
    if (!ids) break;
    if (a) ms[a.meld] = validate([...ms[a.meld].t, ...ids]); else ms.push(validate(m));
    h = h.filter(i => !ids.includes(i)); n += ids.length;
  }
  return n;
}

function discardCost(i, hand, rivalMelds, pozo, fed) {
  if (isWild(i)) return 1e6;
  let c = 0;
  for (const u of hand) {
    if (u === i || isWild(u)) continue;
    const d = Math.abs(num(u) - num(i));
    if (color(u) === color(i) && d > 0 && d <= 2) c += 3 - d;
    if (num(u) === num(i)) c += 1.5;
  }
  c += B.feedRival * (layable([...pozo, i], rivalMelds) - fed);
  if (rivalMelds.some(m => m.t.length === R.canastaLen - 1 && validate([...m.t, i]))) c += B.canastaThreat;
  return c - value(i) / 30;
}

export function botStep(s, p) {
  // Free for all: the rival that matters is the next seat, who can take our discard
  const hand = s.hands[p], mine = s.melds[team(p, s)], rival = s.melds[s.ffa ? team((p + 1) % s.n, s) : 1 - team(p, s)];
  // Keep one tile to discard unless the hand can empty into the muerto or a close
  const canEmpty = (!s.muerto[team(p, s)] && s.muertos.length) || mine.some(isCanasta);
  const ok = ids => canEmpty || hand.length - ids.length >= 2;
  const err = Math.random() < B.mistake;
  if (s.phase === 'draw') {
    if (err) return {type: 'draw'};
    const keep = canEmpty ? 0 : 2;
    const gain = s.pozo.length ? Math.min(layable([...hand, ...s.pozo], mine), hand.length + s.pozo.length - keep) - layable(hand, mine)
      + (hand.length > B.dumpWildsHand ? B.pozoWildGain * s.pozo.filter(isWild).length : 0) + B.pozoDeny * layable(s.pozo, rival) : 0;
    return {type: gain >= B.pozoMinGain ? 'pozo' : 'draw'};
  }
  const add = findAdd(hand, mine);
  if (add && ok(add.ids)) return add;
  const m = findMeld(hand, hand.length > B.wildNewMeldHand);
  if (m && ok(m)) return {type: 'meld', ids: m};
  const fed = layable(s.pozo, rival);
  const cost = new Map(hand.map(i => [i, discardCost(i, hand, rival, s.pozo, fed)]));
  const best = err ? hand[Math.floor(Math.random() * hand.length)] : [...hand].sort((a, b) => cost.get(a) - cost.get(b))[0];
  return {type: 'discard', id: best};
}
