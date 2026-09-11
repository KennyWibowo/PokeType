# PokéType — Version & Update Guide

- **Status:** ✅ Running — public, at [`poketype.wibow.io`](https://poketype.wibow.io)
- **Compose:** [`docker-compose.yml`](./docker-compose.yml) · **Server config:** [`nginx.conf`](./nginx.conf)
- **Audited:** 2026-09-11

A type-effectiveness drill. It names an attacking type and a defender, and you
say whether the move is super effective, neutral, not very effective, or does
nothing at all. The modes and the code layout are in [`README.md`](./README.md).

## Image

Unlike the app stacks it sits next to, this one has **no application image and no
build step**. The app is plain ES modules and static files; nginx bind-mounts
`app/` read-only.

| Service | Image | Version |
|---|---|---|
| poketype | `nginx:1.29-alpine@sha256:5616878291a2…830de` | nginx **1.29** (alpine) |
| test (profile `test`, never started by `up -d`) | `node:22-alpine` | Node **22** |

A deploy is therefore a `git pull` and a browser reload. `docker compose restart`
is only needed after a change to `nginx.conf`, and the image only moves when
nginx itself is upgraded.

## Current state

- **Deployed 2026-09-11.** Four modes — Easy, Medium, Hard, Type ID — one streak
  counter, best-per-mode kept in `localStorage`.
- **Nested git repo**, ignored by the parent homelab repo (the same arrangement
  as `maplestory-party-tracker`). Its own history is the source of truth.
- **No host port is published.** Traefik reaches `:80` over the shared `proxy`
  network.
- ⚠️ **The TLS router deliberately has no `certresolver`.** Traefik already holds
  the `*.wibow.io` wildcard from the cloudflare resolver, declared on the traefik
  dashboard router's `tls.domains`; every other `*.wibow.io` service matches it
  from the store with a bare `tls=true`. Adding a resolver here would issue a
  second, redundant certificate for one hostname.
- **Public DNS is owned by the homelab repo, not this one** — the `poketype`
  entry in `cloudflare-ddns/config.json`, Cloudflare-proxied (`proxied: true`)
  like `maplestory` and `homeassistant`. The A record was created 2026-09-11 and
  follows the home IP from then on. **Changing the hostname means editing that
  file too**, not just the traefik labels here.
- **No backend, no state, no secrets.** Nothing is stored server-side; the only
  persistence is the viewer's own `localStorage`, which never leaves their
  browser. Every read and write of it is wrapped in `try/catch`, so a private
  window or blocked site data degrades to "no best streak" rather than a blank
  page.

### Data and the type chart

- `app/data/pokemon.json` (1025 entries) and `app/sprites/` (1025 × ~4 KB PNGs,
  4.2 MB total) are **checked in**, so a fresh clone runs with no network access
  to GitHub. They are rebuilt by:

  ```bash
  python3 tools/build-dataset.py --sprites   # omit --sprites for data only
  ```

- Only **default forms** are included — no megas, no regional variants, no Rotom
  appliances. They share a dex number with the base form, and a quiz that asks
  about both is just confusing.
- ⚠️ **`MAX_ID` in `tools/build-dataset.py` pins the newest generation** (1025,
  through gen IX). A new generation needs it bumped or its Pokémon are silently
  left out — the script's count assertion is what catches this, so run it after
  any upstream data change rather than assuming.
- The type chart in `app/js/types.js` is **generation VI onwards** (the one with
  Fairy, and with Steel no longer resisting Ghost and Dark). It was verified
  against PokéAPI's `type_efficacy` table when written: **all 324
  attacker/defender pairs matched**. If it is ever edited, re-run that
  comparison rather than eyeballing it.
- ⚠️ **Questions do not sample attacking types uniformly.** A uniform draw makes
  roughly 60% of questions neutral, which teaches very little, so `quiz.js` picks
  a *verdict* first (weighted: 33% super, 33% resisted, 26% neutral, 8% immune)
  and then an attacking type that produces it. Anyone "simplifying" that back to
  a plain random attacker will quietly gut the drill.

## Tests

```bash
docker compose run --rm test
```

17 checks over the type chart, the dataset, the question generator, and the
HTML/JS wiring (every id `app.js` looks up must exist in `index.html` — the
failure that otherwise shows up as a blank screen). No dependencies, no network.

⚠️ **They run in a container on purpose.** The docker host's own Node is **v12**,
which predates `||=` and cannot load this code at all; `node --test` locally will
fail in a way that looks like a bug in the app.

The DOM layer itself has no automated coverage. It was exercised manually through
headless Chrome at deploy — all four modes played through against the public URL
with zero console errors, zero failed requests and no horizontal overflow at
390 px — but that was a one-off script, not a suite that runs again.

## Commit history (condensed)

| Commit | What changed |
|---|---|
| _initial_ | **Initial commit**, 2026-09-11. The whole app: type chart, dataset + sprites, four modes, streak counter, nginx/traefik deployment, dataset rebuild script, and the 17 logic tests. |

## Update steps

**The app** — edit files under `app/`; nginx serves them directly, so reload the
browser. No rebuild, no restart.

**nginx**
1. `docker pull nginx:1.29-alpine`
2. Re-pin the digest:
   ```bash
   docker inspect --format '{{index .RepoDigests 0}}' nginx:1.29-alpine
   ```
3. Update the `image:` line in `docker-compose.yml`, then `docker compose up -d`.

## Re-pinning

Images are pinned `name:tag@sha256:<digest>` so `up -d` never drifts, not even at
the patch level. The `test` service is deliberately **unpinned** — it runs no
deployed code, and pinning it would mean re-pinning to keep the tests on a
supported Node.
