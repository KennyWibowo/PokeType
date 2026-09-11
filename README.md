# PokéType

A quick drill for the Pokémon type chart, at
[poketype.wibow.io](https://poketype.wibow.io). It shows an attacking type and
something to hit with it; you say what happens. Four answers, one streak
counter, no timers.

## Modes

| Mode | The question | What you have to know |
|---|---|---|
| **Easy** | A *Fire* move hits a **Grass** Pokémon | One row of the type chart |
| **Medium** | A *Fire* move hits a **Grass / Poison** Pokémon | Two rows, multiplied together |
| **Hard** | A *Fire* move hits **Bulbasaur** | Its typing is hidden — recall it, then do the maths |
| **Type ID** | What type is **Bulbasaur**? | Pick its one or two types out of all 18 |

Hard and Type ID draw from every generation by default; the pool selector on
the home screen narrows them to the generations you know.

Answers are the four things a move can do — super effective (2× or 4×),
neutral, not very effective (½× or ¼×), or no effect at all. After each one the
result panel shows the arithmetic, e.g. `Fire → Grass 2× · Poison 1× = 2×`, so a
wrong answer explains itself.

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
  js/data.js      the Pokémon list, the generation filter, repeat-avoiding picks
  js/quiz.js      question generation per mode
  js/app.js       state, rendering and input
  data/           pokemon.json — 1025 Pokémon (id, name, generation, types)
  sprites/        1025 96×96 PNGs, rendered pixelated
```

Questions do not sample attacking types uniformly: that makes about 60% of them
neutral, which teaches very little. `quiz.js` picks a *verdict* first and then
an attacking type that produces it, so resistances and immunities come up often
enough to be worth learning.

Deployment, the data pipeline and the test command are in
[`VERSION.md`](./VERSION.md).

## License

The code is MIT — see [`LICENSE`](./LICENSE).

That covers the code only. `app/sprites/` and `app/data/pokemon.json` are
Pokémon sprites and species data sourced from [PokéAPI](https://pokeapi.co);
Pokémon and its names, sprites and type chart are trademarks of Nintendo,
Creatures Inc. and GAME FREAK Inc. This is an unofficial fan project, not
affiliated with or endorsed by any of them.
