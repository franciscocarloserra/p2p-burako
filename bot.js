// Rule-based bot. botStep returns the next action for seat p using only what that seat can see.
import {R, validate, isWild, color, num, value, team, isCanasta} from './game.js?v=2026-10-30.5';

export const B = {
  pozoMinGain: 0,      // take the pozo if it lets us lay down at least this many more tiles
  pozoWildGain: 1,     // each wild in the pozo counts as this many layable tiles
  pozoDeny: 1.5,       // each pozo tile that fits the rival's melds counts this much toward taking it
  wildNewMeldHand: 5,  // only start a meld with a wild when holding more than this many tiles
  dumpWildsHand: 8,    // with this many tiles or fewer, wilds go anywhere (they cost points in hand)
  feedRival: 2,        // discard cost per tile the pozo would let the rival lay down
  canastaThreat: 10,   // extra discard cost when the tile grows a rival meld to canasta length
  pozoConn: 1,         // each point of fit between pozo tiles and our hand counts this much toward taking it
  pairFit: 4,          // fit of a tile with another of the same number
  discardValue: 1 / 30, // discard cost per point the tile is worth (high tiles hurt more if caught in hand)
  wildAddLen: 6,       // add a wild to a clean meld only when it has at least this many tiles
  feedKnown: 6,        // discard cost per point of fit with tiles we saw the rival take from the pozo
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
    if (!m.w && !isCanasta(m) && (dump || m.t.length >= B.wildAddLen) && validate([...m.t, i], m.low)) return {type: 'add', meld: k, ids: [i]};
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

// How well tile i fits the rest of the hand: near tiles of its color and tiles of its number.
function conn(i, hand) {
  if (isWild(i)) return 0;
  let c = 0;
  for (const u of hand) {
    if (u === i || isWild(u)) continue;
    const d = Math.abs(num(u) - num(i));
    if (color(u) === color(i) && d > 0 && d <= 2) c += 3 - d;
    if (num(u) === num(i)) c += B.pairFit;
  }
  return c;
}

function discardCost(i, hand, rivalMelds, pozo, fed) {
  if (isWild(i)) return 1e6;
  let c = conn(i, hand);
  c += B.feedRival * (layable([...pozo, i], rivalMelds) - fed);
  if (rivalMelds.some(m => m.t.length === R.canastaLen - 1 && validate([...m.t, i]))) c += B.canastaThreat;
  return c - value(i) * B.discardValue;
}

function cheapest(hand, rival, pozo, fed, known = []) {
  const cost = new Map(hand.map(i => [i, discardCost(i, hand, rival, pozo, fed) + B.feedKnown * conn(i, known)]));
  return [...hand].sort((a, b) => cost.get(a) - cost.get(b))[0];
}

// Tiles the rival took from the pozo and hasn't shown since. Kept per hand in memory; a reload just forgets.
const seen = new Map();
function rivalKnown(s, p) {
  const k = s.id + ':' + s.round + ':' + p, m = seen.get(k) ?? {left: null, known: []};
  seen.set(k, m);
  if (s.phase === 'draw' && m.left && s.mazo.length === m.mazo && s.pozo.length === 1) { m.known.push(...m.left); m.left = null; }
  const shown = new Set([...s.melds[1 - team(p)].flatMap(x => x.t), ...s.pozo]);
  m.known = m.known.filter(i => !shown.has(i));
  return m;
}

export function botStep(s, p) {
  const hand = s.hands[p], mine = s.melds[team(p)], rival = s.melds[1 - team(p)];
  // Keep one tile to discard unless the hand can empty into the muerto or a close
  const canEmpty = (!s.muerto[team(p)] && s.muertos.length) || mine.some(isCanasta);
  const ok = ids => canEmpty || hand.length - ids.length >= 2;
  const err = Math.random() < B.mistake;
  if (s.phase === 'draw') {
    if (err) return {type: 'draw'};
    const known = s.n === 2 ? rivalKnown(s, p).known : [];
    const keep = canEmpty ? 0 : 2;
    const gain = s.pozo.length ? Math.min(layable([...hand, ...s.pozo], mine), hand.length + s.pozo.length - keep) - layable(hand, mine)
      + (hand.length > B.dumpWildsHand ? B.pozoWildGain * s.pozo.filter(isWild).length : 0) + B.pozoDeny * layable(s.pozo, rival) + B.pozoConn * s.pozo.reduce((a, i) => a + conn(i, hand), 0) : 0;
    if (gain < B.pozoMinGain) return {type: 'draw'};
    // A lone pozo tile we'd throw right back is a wasted turn (and two bots would pass it back and forth forever)
    if (s.pozo.length === 1) {
      const h = [...hand, s.pozo[0]], c = i => discardCost(i, h, rival, [], 0) + B.feedKnown * conn(i, known);
      if (hand.every(i => c(i) >= c(s.pozo[0]))) return {type: 'draw'};
    }
    return {type: 'pozo'};
  }
  const add = findAdd(hand, mine);
  if (add && ok(add.ids)) return add;
  const m = findMeld(hand, hand.length > B.wildNewMeldHand);
  if (m && ok(m)) return {type: 'meld', ids: m};
  const mem = s.n === 2 ? rivalKnown(s, p) : {known: []};
  const id = err ? hand[Math.floor(Math.random() * hand.length)] : cheapest(hand, rival, s.pozo, layable(s.pozo, rival), mem.known);
  if (s.n === 2) { mem.left = [...s.pozo, id]; mem.mazo = s.mazo.length; }
  return {type: 'discard', id};
}
