// SPDX-License-Identifier: AGPL-3.0-or-later
// Pokemon, moves and learnsets: baked from the PokeAPI CSV data at build time
// by tools/build-dataset.py.
//
// Moves and learnsets are fetched lazily, when a mode that needs them starts.
// Only Ultra and Master use them, and learnsets.json is 170 KB - three times
// the size of everything the first four modes need put together.
let POKEMON = null;
let MOVES = null;
let MOVES_BY_ID = null;
let LEARNSETS = null;

export const GENERATIONS = [
  { id: 1, label: 'I', region: 'Kanto' },
  { id: 2, label: 'II', region: 'Johto' },
  { id: 3, label: 'III', region: 'Hoenn' },
  { id: 4, label: 'IV', region: 'Sinnoh' },
  { id: 5, label: 'V', region: 'Unova' },
  { id: 6, label: 'VI', region: 'Kalos' },
  { id: 7, label: 'VII', region: 'Alola' },
  { id: 8, label: 'VIII', region: 'Galar' },
  { id: 9, label: 'IX', region: 'Paldea' },
];

// Bumped whenever the shape of a dataset changes. The files live at fixed URLs
// and were once served `immutable`, so some browsers are still holding a copy
// from before abilities and base stats existed; a new URL is the only thing
// that reaches past that. The nginx config no longer allows it to recur.
const DATA_VERSION = 2;

async function loadJSON(file) {
  const res = await fetch(`data/${file}?v=${DATA_VERSION}`);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return res.json();
}

export async function loadPokemon() {
  if (!POKEMON) {
    POKEMON = await loadJSON('pokemon.json');
    // Fail here, with a sentence that says what to do, rather than several
    // modules deeper with "cannot read properties of undefined".
    const sample = POKEMON[0];
    if (!sample?.stats || !sample?.abilities) {
      throw new Error('the Pokémon data is out of date — reload the page');
    }
  }
  return POKEMON;
}

export async function loadMoves() {
  if (!MOVES) {
    MOVES = await loadJSON('moves.json');
    MOVES_BY_ID = new Map(MOVES.map((m) => [m.id, m]));
  }
  return MOVES;
}

export async function loadLearnsets() {
  LEARNSETS ||= await loadJSON('learnsets.json');
  return LEARNSETS;
}

export function moveById(id) {
  return MOVES_BY_ID.get(id);
}

/** The move ids one Pokémon can learn, or an empty list if it learns none. */
export function learnsetOf(pokemonId) {
  return LEARNSETS[pokemonId] || [];
}

export function spriteUrl(id) {
  return `sprites/${id}.png`;
}

/** Pokemon from the chosen generations; an empty selection means all of them. */
export function pool(gens) {
  if (!POKEMON) return [];
  if (!gens || gens.length === 0) return POKEMON;
  const wanted = new Set(gens);
  return POKEMON.filter((p) => wanted.has(p.gen));
}

/**
 * Moves from the chosen generations. Unlike the Pokemon filter this is
 * cumulative — picking gen III means "a game up to gen III", which is what
 * makes the filter useful rather than pedantic, since a gen III player knows
 * every move up to that point and none after it.
 */
export function movePool(gens) {
  if (!MOVES) return [];
  if (!gens || gens.length === 0) return MOVES;
  const newest = Math.max(...gens);
  return MOVES.filter((m) => m.gen <= newest);
}

/** Pokemon that can attack: in the chosen generations, and know a usable move. */
export function attackerPool(gens, moveIds) {
  return pool(gens).filter((p) => {
    const known = LEARNSETS[p.id];
    return known && known.some((id) => moveIds.has(id));
  });
}

export function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Picks from `list` while avoiding the last few picks, so a short run of
 * questions does not repeat itself. Falls back to a plain pick when the pool
 * is too small for that to be possible.
 */
export function pickFresh(list, recent, memory = 12) {
  if (list.length === 0) return null;
  let choice = randomOf(list);
  if (list.length > memory) {
    let guard = 0;
    while (recent.includes(choice.id ?? choice) && guard++ < 40) {
      choice = randomOf(list);
    }
  }
  recent.push(choice.id ?? choice);
  while (recent.length > memory) recent.shift();
  return choice;
}
