// Pokemon pool: the 1025 default forms of generations I-IX, baked from the
// PokeAPI CSV data at build time (see ../../VERSION.md).
let POKEMON = null;

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

export async function loadPokemon() {
  if (!POKEMON) {
    const res = await fetch('data/pokemon.json');
    if (!res.ok) throw new Error(`pokemon.json: ${res.status}`);
    POKEMON = await res.json();
  }
  return POKEMON;
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
