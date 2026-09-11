import { TYPES, multiplier, verdictOf } from './types.js';
import { pool, pickFresh, randomOf } from './data.js';

export const MODES = {
  easy:   { title: 'Easy',   blurb: 'One defending type.' },
  medium: { title: 'Medium', blurb: 'Two defending types.' },
  hard:   { title: 'Hard',   blurb: 'A Pokémon — you infer its typing.' },
  typeid: { title: 'Type ID', blurb: 'Name a Pokémon\'s type(s).' },
};

// Uniform attacker sampling makes ~60% of questions neutral, which teaches
// very little. Aim for a verdict first, then pick an attacker that produces
// it, so resisted and immune show up often enough to be worth learning.
const VERDICT_WEIGHTS = { super: 0.33, resisted: 0.33, neutral: 0.26, immune: 0.08 };

function pickAttacker(defenderTypes) {
  const byVerdict = {};
  for (const attacker of TYPES) {
    const verdict = verdictOf(multiplier(attacker, defenderTypes));
    (byVerdict[verdict] ||= []).push(attacker);
  }
  const available = Object.keys(byVerdict);
  const total = available.reduce((sum, v) => sum + VERDICT_WEIGHTS[v], 0);
  let roll = Math.random() * total;
  for (const verdict of available) {
    roll -= VERDICT_WEIGHTS[verdict];
    if (roll <= 0) return randomOf(byVerdict[verdict]);
  }
  return randomOf(byVerdict[available[available.length - 1]]);
}

// Real dual typings only, so Medium never asks about a combination that no
// Pokémon actually has. Built once, on the first Medium question.
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

const recent = { easy: [], medium: [], hard: [], typeid: [] };

/**
 * Builds the next question. `all` is the full dataset, `gens` the generation
 * filter (Pokémon-based modes only).
 */
export function nextQuestion(mode, all, gens) {
  if (mode === 'typeid') {
    const pokemon = pickFresh(pool(gens), recent.typeid);
    return { mode, pokemon, answer: pokemon.types };
  }

  let pokemon = null;
  let defenderTypes;
  if (mode === 'easy') {
    defenderTypes = [pickFresh(TYPES, recent.easy, 6)];
  } else if (mode === 'medium') {
    defenderTypes = pickFresh(realDualTypings(all), recent.medium).slice();
  } else {
    pokemon = pickFresh(pool(gens), recent.hard);
    defenderTypes = pokemon.types;
  }

  const attacker = pickAttacker(defenderTypes);
  const mult = multiplier(attacker, defenderTypes);
  return { mode, attacker, defenderTypes, pokemon, multiplier: mult, answer: verdictOf(mult) };
}

/** Type ID is order-independent: Grass/Poison and Poison/Grass both count. */
export function sameTypes(a, b) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}
