// The Gen V+ damage formula, enough of it to grade a guess.
//
// Deliberately fixed so that one question has one answer: level 50, 31 IVs,
// no EVs, neutral nature, no items, weather, screens, crits or burn. The random
// roll is pinned to its average rather than sampled, so the number shown is the
// one the formula gives, not one of 16 possibilities.
//
// Abilities ARE modelled, but only the ones whose effect is unconditional given
// everything above — see ABILITIES below for why that line is drawn where it
// is. Anything else is a no-op, which is the honest answer when the quiz does
// not model the condition the ability depends on.
import { multiplier } from './types.js';

export const LEVEL = 50;
export const AVERAGE_ROLL = 0.925;   // mean of the 0.85 - 1.00 damage roll

const IV = 31;
const EV = 0;

/** One stat at LEVEL. HP uses a different constant from everything else. */
export function statAt(base, isHp = false) {
  const shared = Math.floor(((2 * base + IV + Math.floor(EV / 4)) * LEVEL) / 100);
  return isHp ? shared + LEVEL + 10 : shared + 5;
}

/** A Pokémon's six stats at LEVEL, from the base stats in pokemon.json. */
export function statsOf(pokemon) {
  const [hp, atk, def, spa, spd, spe] = pokemon.stats;
  return {
    hp: statAt(hp, true),
    atk: statAt(atk),
    def: statAt(def),
    spa: statAt(spa),
    spd: statAt(spd),
    spe: statAt(spe),
  };
}

/** Stat stages: +1 is 1.5x, -1 is 2/3x, and it saturates at +-6. */
export function boostMultiplier(stage) {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

/* ---------------------------------------------------------------- abilities */

const lower = (name) => (name || '').toLowerCase();
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// Defender abilities that make a whole attacking type do nothing.
const ABSORBS = {
  levitate: 'ground',
  'earth eater': 'ground',
  'flash fire': 'fire',
  'well-baked body': 'fire',
  'water absorb': 'water',
  'storm drain': 'water',
  'dry skin': 'water',
  'volt absorb': 'electric',
  'lightning rod': 'electric',
  'motor drive': 'electric',
  'sap sipper': 'grass',
};

// Defender abilities that scale damage from particular attacking types.
const DEFENDER_TYPE_FILTERS = {
  'thick fat': { fire: 0.5, ice: 0.5 },
  heatproof: { fire: 0.5 },
  'water bubble': { fire: 0.5 },
  'purifying salt': { ghost: 0.5 },
  'dry skin': { fire: 1.25 },
};

// Attacker abilities that scale the power of particular move types.
const ATTACKER_TYPE_BOOSTS = {
  transistor: { electric: 1.3 },
  "dragon's maw": { dragon: 1.5 },
  'rocky payload': { rock: 1.5 },
  steelworker: { steel: 1.5 },
};

/**
 * Abilities are only modelled when their effect is unconditional here.
 *
 * Excluded on purpose, and why:
 *
 *  - Anything keyed on a move flag — Bulletproof, Soundproof, Iron Fist,
 *    Sharpness, Fluffy's contact halving. moves.json carries no flags, so
 *    applying half of Fluffy would be worse than applying none of it.
 *  - Anything keyed on weather, status, held items or stat drops, none of
 *    which this calculator has: Chlorophyll, Guts, Sheer Force, Drought.
 *  - Anything keyed on remaining HP. Overgrow, Blaze, Torrent and Swarm only
 *    fire below a third; both sides here are at full HP, so a no-op is the
 *    correct result, not a missing feature. Multiscale is the mirror image —
 *    full HP is exactly when it applies, so it is modelled.
 */
export const ABILITIES = {
  absorbs: ABSORBS,
  defenderTypeFilters: DEFENDER_TYPE_FILTERS,
  attackerTypeBoosts: ATTACKER_TYPE_BOOSTS,
};

export function boostLabel(stage, cls) {
  const stat = cls === 'physical' ? 'Atk' : 'Sp. Atk';
  if (stage === 0) return 'no stat changes';
  return `${stage > 0 ? '+' : '−'}${Math.abs(stage)} ${stat}`;
}

/**
 * Damage one move does to one defender, as a flat number and as a share of the
 * defender's HP. Percent is capped at 100 — past that it is a KO either way,
 * and the slider cannot express more.
 */
export function calculate(attacker, move, defender, stage = 0, abilities = {}) {
  const atkAbility = lower(abilities.attacker);
  const defAbility = lower(abilities.defender);
  const notes = [];

  const a = statsOf(attacker);
  const d = statsOf(defender);
  const physical = move.cls === 'physical';

  // --- power, before anything else uses it
  let power = move.power;
  if (atkAbility === 'technician' && power <= 60) {
    power = Math.floor(power * 1.5);
    notes.push('Technician boosts moves of 60 BP or less by half');
  }
  const typeBoost = ATTACKER_TYPE_BOOSTS[atkAbility]?.[move.type];
  if (typeBoost) {
    power = Math.floor(power * typeBoost);
    notes.push(`${abilities.attacker} boosts ${cap(move.type)} moves`);
  }

  // --- attack stat: stage first, then the ability that doubles the stat
  let attackStat = Math.floor((physical ? a.atk : a.spa) * boostMultiplier(stage));
  if ((atkAbility === 'huge power' || atkAbility === 'pure power') && physical) {
    attackStat *= 2;
    notes.push(`${abilities.attacker} doubles Attack`);
  }
  const defenseStat = physical ? d.def : d.spd;

  // --- type effectiveness, and the abilities that override it outright
  let effectiveness = multiplier(move.type, defender.types);
  if (ABSORBS[defAbility] === move.type) {
    effectiveness = 0;
    notes.push(`${abilities.defender} makes it immune to ${cap(move.type)}`);
  } else if (defAbility === 'wonder guard' && effectiveness <= 1) {
    effectiveness = 0;
    notes.push('Wonder Guard blocks anything but a super-effective hit');
  }

  let stab = attacker.types.includes(move.type) ? 1.5 : 1;
  if (stab > 1 && atkAbility === 'adaptability') {
    stab = 2;
    notes.push('Adaptability raises STAB to 2×');
  }

  const base = Math.floor(
    Math.floor((Math.floor((2 * LEVEL) / 5 + 2) * power * attackStat) / defenseStat) / 50,
  ) + 2;

  // Modifiers apply in sequence, each truncated: roll, then STAB, then type.
  let damage = Math.floor(base * AVERAGE_ROLL);
  damage = Math.floor(damage * stab);
  damage = Math.floor(damage * effectiveness);

  // --- everything that scales the finished figure
  for (const [multiplierValue, note] of finalModifiers({
    atkAbility, defAbility, abilities, move, effectiveness, physical,
  })) {
    damage = Math.floor(damage * multiplierValue);
    notes.push(note);
  }

  return {
    damage,
    hp: d.hp,
    percent: Math.min(100, (damage / d.hp) * 100),
    attackStat,
    defenseStat,
    power,
    effectiveness,
    stab,
    physical,
    notes,
  };
}

/** [multiplier, explanation] pairs applied to the finished damage figure. */
function finalModifiers({ atkAbility, defAbility, abilities, move, effectiveness, physical }) {
  const out = [];
  if (effectiveness === 0) return out;   // nothing scales zero into something

  const filter = DEFENDER_TYPE_FILTERS[defAbility]?.[move.type];
  if (filter) {
    out.push([filter, `${abilities.defender} ${filter < 1 ? 'softens' : 'worsens'} ${cap(move.type)} damage`]);
  }
  if (effectiveness > 1) {
    if (['filter', 'solid rock', 'prism armor'].includes(defAbility)) {
      out.push([0.75, `${abilities.defender} blunts super-effective hits`]);
    }
    if (atkAbility === 'neuroforce') {
      out.push([1.25, 'Neuroforce sharpens super-effective hits']);
    }
  }
  if (effectiveness < 1 && atkAbility === 'tinted lens') {
    out.push([2, 'Tinted Lens doubles a resisted hit']);
  }
  if (['multiscale', 'shadow shield'].includes(defAbility)) {
    // Both sides start at full HP here, which is exactly when this applies.
    out.push([0.5, `${abilities.defender} halves damage at full HP`]);
  }
  if (defAbility === 'fur coat' && physical) {
    out.push([0.5, 'Fur Coat halves physical damage']);
  }
  if (defAbility === 'ice scales' && !physical) {
    out.push([0.5, 'Ice Scales halves special damage']);
  }
  return out;
}
