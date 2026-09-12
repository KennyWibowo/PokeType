// SPDX-License-Identifier: AGPL-3.0-or-later
// The Gen 6+ type chart, written as the exceptions only: anything an attacking
// type is not listed against deals neutral (1x) damage to it.
export const TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
];

const CHART = {
  normal:   { half: ['rock', 'steel'], zero: ['ghost'] },
  fire:     { double: ['grass', 'ice', 'bug', 'steel'], half: ['fire', 'water', 'rock', 'dragon'] },
  water:    { double: ['fire', 'ground', 'rock'], half: ['water', 'grass', 'dragon'] },
  electric: { double: ['water', 'flying'], half: ['electric', 'grass', 'dragon'], zero: ['ground'] },
  grass:    { double: ['water', 'ground', 'rock'], half: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'] },
  ice:      { double: ['grass', 'ground', 'flying', 'dragon'], half: ['fire', 'water', 'ice', 'steel'] },
  fighting: { double: ['normal', 'ice', 'rock', 'dark', 'steel'], half: ['poison', 'flying', 'psychic', 'bug', 'fairy'], zero: ['ghost'] },
  poison:   { double: ['grass', 'fairy'], half: ['poison', 'ground', 'rock', 'ghost'], zero: ['steel'] },
  ground:   { double: ['fire', 'electric', 'poison', 'rock', 'steel'], half: ['grass', 'bug'], zero: ['flying'] },
  flying:   { double: ['grass', 'fighting', 'bug'], half: ['electric', 'rock', 'steel'] },
  psychic:  { double: ['fighting', 'poison'], half: ['psychic', 'steel'], zero: ['dark'] },
  bug:      { double: ['grass', 'psychic', 'dark'], half: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'] },
  rock:     { double: ['fire', 'ice', 'flying', 'bug'], half: ['fighting', 'ground', 'steel'] },
  ghost:    { double: ['psychic', 'ghost'], half: ['dark'], zero: ['normal'] },
  dragon:   { double: ['dragon'], half: ['steel'], zero: ['fairy'] },
  dark:     { double: ['psychic', 'ghost'], half: ['fighting', 'dark', 'fairy'] },
  steel:    { double: ['ice', 'rock', 'fairy'], half: ['fire', 'water', 'electric', 'steel'] },
  fairy:    { double: ['fighting', 'dragon', 'dark'], half: ['fire', 'poison', 'steel'] },
};

// Flattened { attacker: { defender: multiplier } }, built once at load.
const LOOKUP = {};
for (const [attacker, rules] of Object.entries(CHART)) {
  const row = {};
  for (const t of rules.double || []) row[t] = 2;
  for (const t of rules.half || []) row[t] = 0.5;
  for (const t of rules.zero || []) row[t] = 0;
  LOOKUP[attacker] = row;
}

/** Multiplier of a single attacking type against one defending type. */
export function against(attacker, defender) {
  const row = LOOKUP[attacker];
  return row && defender in row ? row[defender] : 1;
}

/** Multiplier against a whole defending Pokemon (one or two types). */
export function multiplier(attacker, defenderTypes) {
  return defenderTypes.reduce((m, t) => m * against(attacker, t), 1);
}

export const VERDICTS = ['super', 'neutral', 'resisted', 'immune'];

export const VERDICT_LABEL = {
  super: 'Super effective',
  neutral: 'Neutral',
  resisted: 'Not very effective',
  immune: 'No effect',
};

/** Which of the four answers a multiplier corresponds to. */
export function verdictOf(mult) {
  if (mult === 0) return 'immune';
  if (mult > 1) return 'super';
  if (mult < 1) return 'resisted';
  return 'neutral';
}

/**
 * "4x", "0.25x", "1x" - trims the trailing zeros 0.5 and 0.25 would keep.
 *
 * Four decimals rather than two because an ability can land a multiplier on a
 * value the chart alone never produces: Filter blunts a 2x hit to 1.5x, Dry
 * Skin worsens a quarter-resisted Fire move to 0.3125x. All of them are dyadic
 * fractions, so this stays exact rather than rounding the spread into a lie.
 */
export function formatMultiplier(mult) {
  return `${Number(mult.toFixed(4))}×`;
}
