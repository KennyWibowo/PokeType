// SPDX-License-Identifier: AGPL-3.0-or-later
import { TYPES, multiplier, verdictOf } from './types.js';
import { pool, movePool, attackerPool, moveById, learnsetOf, pickFresh, randomOf } from './data.js';
import {
  calculate, defensiveProfile, profileKey, profileAbilities, couldShowProfile,
} from './damage.js';

// `ball` names the icon in balls.js; `needs` lists the lazily-fetched datasets
// the mode cannot start without; `answers` selects the input the UI renders.
export const MODES = {
  easy: {
    title: 'Easy', ball: 'safari', answers: 'multiplier', needs: [], group: 'effect',
    name: 'Single type',
    blurb: 'One attacking type against one defending type.',
  },
  medium: {
    title: 'Medium', ball: 'poke', answers: 'multiplier', needs: [], group: 'effect',
    name: 'Dual type',
    blurb: 'Two defending types, so the multipliers stack — 4× and ¼× are in play.',
  },
  hard: {
    title: 'Hard', ball: 'great', answers: 'multiplier', needs: [], group: 'effect',
    name: 'Name the damage',
    blurb: 'Only the Pokémon is shown — recall its typing first.',
  },
  ultra: {
    title: 'Ultra', ball: 'ultra', answers: 'multiplier', needs: ['moves'], group: 'effect',
    name: 'Name the move',
    blurb: 'A move name, not a type. You need both halves from memory.',
  },
  master: {
    title: 'Master', ball: 'master', answers: 'slider', needs: ['moves', 'learnsets'], group: 'effect',
    name: 'Run the numbers',
    blurb: 'A real matchup with stat boosts. Guess how much HP it takes.',
  },
  typeid: {
    title: 'Type ID', ball: 'premier', answers: 'types', needs: [], group: 'typing',
    name: 'What type is it?',
    blurb: 'A Pokémon appears; pick its one or two types.',
  },
  dexid: {
    title: 'Dex ID', ball: 'timer', answers: 'pokemon', needs: [], group: 'typing',
    name: 'Which Pokémon is it?',
    blurb: 'A whole defensive spread — weaknesses, resistances, immunities, abilities included.',
  },
};

// Every multiplier a single defending type can produce, and every one a pair
// can. The UI renders exactly these as the answer buttons.
export const SINGLE_TYPE_MULTIPLIERS = [2, 1, 0.5, 0];
export const DUAL_TYPE_MULTIPLIERS = [4, 2, 1, 0.5, 0.25, 0];

// Uniform attacker sampling makes ~60% of questions neutral, which teaches very
// little. Aim for a multiplier first, then pick an attacking type that produces
// it. 4x and 0.25x are weighted below the common results on purpose: they should
// come up often enough to learn, not so often that the drill stops resembling
// the game.
const MULTIPLIER_WEIGHTS = new Map([
  [4, 0.12], [2, 0.22], [1, 0.24], [0.5, 0.22], [0.25, 0.12], [0, 0.08],
]);

/** Groups candidates by the multiplier they produce against `defenderTypes`. */
function groupByMultiplier(candidates, typeOf) {
  const groups = new Map();
  for (const candidate of candidates) {
    const mult = typeOf(candidate);
    if (!groups.has(mult)) groups.set(mult, []);
    groups.get(mult).push(candidate);
  }
  return groups;
}

/** Weighted pick of one group, renormalised over whichever groups exist. */
function pickWeighted(groups) {
  const keys = [...groups.keys()];
  const total = keys.reduce((sum, k) => sum + (MULTIPLIER_WEIGHTS.get(k) ?? 0.1), 0);
  let roll = Math.random() * total;
  for (const key of keys) {
    roll -= MULTIPLIER_WEIGHTS.get(key) ?? 0.1;
    if (roll <= 0) return randomOf(groups.get(key));
  }
  return randomOf(groups.get(keys[keys.length - 1]));
}

function pickAttackingType(defenderTypes) {
  return pickWeighted(groupByMultiplier(TYPES, (t) => multiplier(t, defenderTypes)));
}

function pickMove(defenderTypes, moves) {
  return pickWeighted(groupByMultiplier(moves, (m) => multiplier(m.type, defenderTypes)));
}

// Real dual typings only, so Medium never asks about a combination no Pokémon
// has. Built once, on the first Medium question.
let dualTypings = null;

function realDualTypings(all) {
  if (!dualTypings) {
    const seen = new Map();
    for (const p of all) {
      if (p.types.length === 2) seen.set(p.types.join('/'), p.types);
    }
    dualTypings = [...seen.values()];
  }
  return dualTypings;
}

const recent = { easy: [], medium: [], hard: [], ultra: [], master: [], typeid: [], dexid: [] };

/* ------------------------------------------------------------------ master */

// Stat stages the attacker may arrive with. Wider than a typical turn-one
// matchup so the sampler below has room to reach every damage bracket.
const STAGES = [-2, -1, 0, 0, 1, 2, 3, 4];

const BUCKETS = 8;   // 12.5 percentage points each, across 0-100

function bucketOf(percent) {
  return Math.min(BUCKETS - 1, Math.floor(percent / (100 / BUCKETS)));
}

/**
 * A damage question aimed at an evenly-spread answer.
 *
 * Sampling attacker, move and defender at random is heavily bottom-weighted:
 * most attacks take a third of a health bar, and the tail that does not is
 * mostly an outright KO. So pick the *bracket* uniformly first and search for a
 * matchup that lands in it, keeping the closest miss as a fallback. The slider
 * is therefore worth reading in full, rather than "guess 30% and be roughly
 * right most of the time".
 */
function masterQuestion(gens) {
  const moves = movePool(gens);
  const moveIds = new Set(moves.map((m) => m.id));
  const attackers = attackerPool(gens, moveIds);
  const defenders = pool(gens);
  const target = Math.floor(Math.random() * BUCKETS);

  let fallback = null;
  let fallbackDistance = Infinity;

  for (let attempt = 0; attempt < 400; attempt++) {
    const attacker = randomOf(attackers);
    const known = learnsetOf(attacker.id).filter((id) => moveIds.has(id));
    const move = moveById(randomOf(known));
    const defender = randomOf(defenders);
    if (defender.id === attacker.id) continue;
    const stage = randomOf(STAGES);

    // One ability each, drawn from everything that Pokémon can actually have
    // (hidden slot included). Both are shown, so Levitate is a fair question
    // rather than a trick — and most draws are no-ops, which is the point:
    // you have to check.
    const abilities = {
      attacker: randomOf(attacker.abilities ?? []),
      defender: randomOf(defender.abilities ?? []),
    };

    const result = calculate(attacker, move, defender, stage, abilities);
    const question = {
      mode: 'master', attacker, move, defender, stage, abilities, result,
      answer: Math.round(result.percent),
    };

    const distance = Math.abs(bucketOf(result.percent) - target);
    if (distance === 0) {
      recent.master.push(attacker.id);
      if (recent.master.length > 12) recent.master.shift();
      return question;
    }
    if (distance < fallbackDistance) {
      fallbackDistance = distance;
      fallback = question;
    }
  }
  return fallback;
}

/* ------------------------------------------------------------------ dex ID */

export const DEXID_OPTIONS = 4;

// How often the spread on screen has been bent by an ability rather than being
// the chart's own. Rare enough that the chart stays the thing being drilled;
// often enough that a Ground immunity on something that is not Flying has to be
// explained rather than dismissed as a bug.
const ABILITY_CHANCE = 0.3;

/** Fisher-Yates, so the answer is not always in the same slot. */
function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Three Pokémon that could not be showing this spread — checked against every
 * ability each of them can have, not just the chart, because the ability in
 * play is not shown. Without that, a spread with Ground at 0x could equally be
 * the Flying type sat next to it or the Levitate one, and the question would
 * have two right answers.
 *
 * Typings that overlap the answer's are preferred: four unrelated Pokémon turn
 * this into a recognition test, where three near misses make it a chart one. One
 * that shares *both* types is normally rejected by the check above, since it
 * produces the same spread - but when an ability has bent the answer's, it is
 * rejected only if it could hold an ability that bends its own the same way.
 */
function pickDistractors(target, key, candidates) {
  const related = candidates.filter((p) => p.types.some((t) => target.types.includes(t)));
  const chosen = [];
  const taken = new Set([target.id]);

  for (const list of [related, candidates]) {
    for (let attempt = 0; attempt < 300 && chosen.length < DEXID_OPTIONS - 1; attempt++) {
      const p = randomOf(list);
      if (!p || taken.has(p.id) || couldShowProfile(p, key)) continue;
      taken.add(p.id);
      chosen.push(p);
    }
    if (chosen.length === DEXID_OPTIONS - 1) break;
  }
  return chosen;
}

// profileAbilities walks the chart once per ability, and the sampler below asks
// about the same 1025 species on every question. Memoise it by dex number.
const benderCache = new Map();

function bendersOf(pokemon) {
  if (!benderCache.has(pokemon.id)) benderCache.set(pokemon.id, profileAbilities(pokemon));
  return benderCache.get(pokemon.id);
}

/**
 * A defensive spread, and four Pokémon one of which has it.
 *
 * The kind of spread is picked before the Pokémon is, the way every other mode
 * picks its result first: only about one species in seven has an ability that
 * bends its spread, so drawing one at random and then asking whether it has one
 * would make the bent rows a curiosity rather than something you learn to watch
 * for.
 *
 * The ability itself is deliberately not part of the question. Being told
 * "Levitate" hands over the answer in a word; leaving it out makes the odd row
 * the clue — something here is immune to Ground and none of the four is Flying,
 * so which of them can hold the ability that does that? The result panel names
 * it either way.
 */
function dexidQuestion(gens) {
  const candidates = pool(gens);
  const benders = Math.random() < ABILITY_CHANCE
    ? candidates.filter((p) => bendersOf(p).length > 0)
    : [];

  const pokemon = pickFresh(benders.length > 0 ? benders : candidates, recent.dexid);
  const ability = benders.length > 0 ? randomOf(bendersOf(pokemon)) : null;
  const profile = defensiveProfile(pokemon, ability);

  return {
    mode: 'dexid',
    pokemon,
    ability,
    profile,
    options: shuffle([pokemon, ...pickDistractors(pokemon, profileKey(profile), candidates)]),
    answer: pokemon.id,
  };
}

/* --------------------------------------------------------------- questions */

/**
 * Builds the next question. `all` is the full dataset, `gens` the generation
 * filter. Modes with a `needs` list require those datasets to be loaded first.
 */
export function nextQuestion(mode, all, gens) {
  if (mode === 'typeid') {
    const pokemon = pickFresh(pool(gens), recent.typeid);
    return { mode, pokemon, answer: pokemon.types };
  }
  if (mode === 'master') {
    return masterQuestion(gens);
  }
  if (mode === 'dexid') {
    return dexidQuestion(gens);
  }

  let pokemon = null;
  let defenderTypes;
  if (mode === 'easy') {
    defenderTypes = [pickFresh(TYPES, recent.easy, 6)];
  } else if (mode === 'medium') {
    defenderTypes = pickFresh(realDualTypings(all), recent.medium).slice();
  } else {
    pokemon = pickFresh(pool(gens), recent[mode]);
    defenderTypes = pokemon.types;
  }

  // Ultra names a move and nothing else — the attacking type has to come from
  // knowing the move, the defending type from knowing the Pokémon.
  const move = mode === 'ultra' ? pickMove(defenderTypes, movePool(gens)) : null;
  const attacker = move ? move.type : pickAttackingType(defenderTypes);
  const mult = multiplier(attacker, defenderTypes);

  return {
    mode, attacker, move, defenderTypes, pokemon,
    multiplier: mult,
    verdict: verdictOf(mult),
    answer: mult,
    options: defenderTypes.length > 1 || mode !== 'easy'
      ? DUAL_TYPE_MULTIPLIERS
      : SINGLE_TYPE_MULTIPLIERS,
  };
}

/** Type ID is order-independent: Grass/Poison and Poison/Grass both count. */
export function sameTypes(a, b) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

// How far a Master guess may be from the real figure, in percentage points.
export const GRADES = [
  { within: 3, label: 'Spot on' },
  { within: 6, label: 'Very close' },
  { within: 10, label: 'Close enough' },
];

export function gradeGuess(guess, actual) {
  const delta = Math.abs(guess - actual);
  const grade = GRADES.find((g) => delta <= g.within);
  return { delta, label: grade ? grade.label : 'Too far off', correct: Boolean(grade) };
}
