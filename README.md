# PokéType

A quick drill for the Pokémon type chart, at
[poketype.wibow.io](https://poketype.wibow.io). It shows an attacking type and
something to hit with it; you say what happens. Six modes up a difficulty
ladder, one streak counter, no timers.

## Modes

A difficulty ladder, each rung marked with the ball it is named after.

| | Mode | The question | What you have to know |
|---|---|---|---|
| Safari | **Easy** | A *Fire* move hits a **Grass** Pokémon | One row of the type chart |
| Poké | **Medium** | A *Fire* move hits a **Grass / Poison** Pokémon | Two rows, multiplied together |
| Great | **Hard** | A *Fire* move hits **Bulbasaur** | Its typing is hidden — recall it, then do the maths |
| Ultra | **Ultra** | **Flamethrower** hits **Bulbasaur** | The move's type *and* the Pokémon's, from memory |
| Master | **Master** | **Scyther** at +4 Atk uses **X-Scissor** on **Typhlosion** | The whole damage formula |
| Premier | **Type ID** | What type is **Bulbasaur**? | Pick its one or two types out of all 18 |

Easy offers the four results a single type can produce. Medium, Hard and Ultra
offer all six — 4×, 2×, 1×, ½×, ¼× and 0× — because two types multiply, and
because Hard and Ultra hide the typing, so a narrower list would leak the
answer. After each one the result panel shows the arithmetic, e.g.
`Fire → Grass 2× · Poison 1× = 2×`, so a wrong answer explains itself.

Hard, Ultra, Master and Type ID draw from every generation by default; the pool
selector on the home screen narrows them. Moves are cumulative up to the newest
generation you pick, since a player who knows gen III knows every move up to it.

Moves whose type is not a property of the move are left out entirely — Hidden
Power takes its type from the user's IVs, Judgment from a held Plate, Tera Blast
from a Terastal type, Weather Ball from the weather. Ultra asks you to infer the
type from the name, so a move with no knowable type is unanswerable rather than
hard.

### Master mode

A full damage calculation, answered on a slider: how much of the defender's HP
does this take? You are graded on how close you get — within 3 points is *spot
on*, within 10 keeps the streak alive.

The attacker only ever uses a move it can actually learn, and both sides show
one of their real abilities, which the calculation respects: **Levitate really
does zero an Earthquake**, Thick Fat really does soften a Fire move, Wonder
Guard really does stop everything that is not super effective. Most draws are
no-ops, which is the point — you have to check.

Everything else is pinned so one question has one answer: level 50, 31 IVs, no
EVs, neutral nature, the average damage roll, and no items, weather or screens.
Abilities that depend on any of those — Guts, Chlorophyll, Sheer Force — are
deliberately not modelled; `js/damage.js` says why next to the list.

Questions are not sampled uniformly. Random matchups pile up around "a third of
a health bar", so Master picks a damage bracket first and searches for a matchup
that lands in it. The slider is worth reading in full.

The streak counts correct answers in a row and resets on a miss. Your best
streak per mode is kept in `localStorage`, which is per-browser and never
leaves it.

**Keyboard:** `1`–`4` answer, `Enter` moves to the next question, `Esc` goes
back to the mode list.

## How it is built

No framework, no build step, no dependencies. `app/` is served as-is by nginx:

```
app/
  index.html      every screen, toggled with [hidden]
  styles.css      dark theme; the 18 type colours are CSS custom properties
  js/types.js     the generation VI+ type chart and the multiplier maths
  js/damage.js    the damage formula, stat stages and the modelled abilities
  js/data.js      the datasets, the generation filter, repeat-avoiding picks
  js/quiz.js      question generation per mode
  js/balls.js     the six Poké Ball icons, as inline SVG
  js/app.js       state, rendering and input
  data/
    pokemon.json    1025 Pokémon — types, base stats, abilities
    moves.json      532 damaging moves with a fixed type and a fixed, single-hit power
    learnsets.json  which of those each Pokémon can learn
  sprites/        1025 96×96 PNGs, rendered pixelated
```

`moves.json` and `learnsets.json` are fetched only when Ultra or Master starts —
learnsets alone are three times the size of everything the first four modes
need.

Questions do not sample attacking types uniformly: that makes about 60% of them
neutral, which teaches very little. `quiz.js` picks a *result* first and then an
attacking type that produces it, so resistances and immunities come up often
enough to be worth learning. Master does the same thing with damage brackets.

## Running it

```bash
docker compose up -d          # nginx serving app/ on the traefik proxy network
docker compose run --rm test  # 37 logic tests, in node:22-alpine
python3 tools/build-dataset.py --sprites   # rebuild the Pokémon data
```

Deployment specifics — the reverse proxy wiring, TLS, DNS and the host it runs
on — are deliberately kept out of this repo; they live with the infrastructure
that owns them.

## License

The code is MIT — see [`LICENSE`](./LICENSE).

That covers the code only. `app/sprites/` and `app/data/pokemon.json` are
Pokémon sprites and species data sourced from [PokéAPI](https://pokeapi.co);
Pokémon and its names, sprites and type chart are trademarks of Nintendo,
Creatures Inc. and GAME FREAK Inc. This is an unofficial fan project, not
affiliated with or endorsed by any of them.
