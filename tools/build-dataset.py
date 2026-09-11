#!/usr/bin/env python3
"""Rebuild app/data/pokemon.json and app/sprites/ from PokeAPI.

Both are checked in, so this only needs running when a new generation lands.
It reads the CSV sources rather than the REST API: three requests instead of
a thousand, and the same data.

    python3 tools/build-dataset.py            # data only
    python3 tools/build-dataset.py --sprites  # data + re-download every sprite
"""
import argparse
import csv
import io
import json
import pathlib
import urllib.request

CSV_BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv"
SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon"
APP = pathlib.Path(__file__).resolve().parent.parent / "app"

# The last id of the newest generation's default forms. Bump this when a new
# generation is released, or the new Pokemon are silently left out.
MAX_ID = 1025

TYPE_IDS = {
    1: "normal", 2: "fighting", 3: "flying", 4: "poison", 5: "ground", 6: "rock",
    7: "bug", 8: "ghost", 9: "steel", 10: "fire", 11: "water", 12: "grass",
    13: "electric", 14: "psychic", 15: "ice", 16: "dragon", 17: "dark", 18: "fairy",
}

# PokeAPI identifiers are slugs. Most title-case cleanly; these do not, either
# because of punctuation or because the default form carries a suffix that is
# not part of the name anyone knows ("giratina-altered" -> "Giratina").
SPECIAL = {
    "nidoran-f": "Nidoran♀", "nidoran-m": "Nidoran♂", "farfetchd": "Farfetch'd",
    "mr-mime": "Mr. Mime", "mime-jr": "Mime Jr.", "mr-rime": "Mr. Rime",
    "ho-oh": "Ho-Oh", "porygon-z": "Porygon-Z", "type-null": "Type: Null",
    "jangmo-o": "Jangmo-o", "hakamo-o": "Hakamo-o", "kommo-o": "Kommo-o",
    "tapu-koko": "Tapu Koko", "tapu-lele": "Tapu Lele", "tapu-bulu": "Tapu Bulu",
    "tapu-fini": "Tapu Fini", "sirfetchd": "Sirfetch'd", "flabebe": "Flabébé",
    "deoxys-normal": "Deoxys", "wormadam-plant": "Wormadam", "giratina-altered": "Giratina",
    "shaymin-land": "Shaymin", "basculin-red-striped": "Basculin",
    "darmanitan-standard": "Darmanitan", "tornadus-incarnate": "Tornadus",
    "thundurus-incarnate": "Thundurus", "landorus-incarnate": "Landorus",
    "keldeo-ordinary": "Keldeo", "meloetta-aria": "Meloetta",
    "meowstic-male": "Meowstic", "aegislash-shield": "Aegislash",
    "pumpkaboo-average": "Pumpkaboo", "gourgeist-average": "Gourgeist",
    "zygarde-50": "Zygarde", "oricorio-baile": "Oricorio",
    "lycanroc-midday": "Lycanroc", "wishiwashi-solo": "Wishiwashi",
    "minior-red-meteor": "Minior", "mimikyu-disguised": "Mimikyu",
    "toxtricity-amped": "Toxtricity", "eiscue-ice": "Eiscue",
    "indeedee-male": "Indeedee", "morpeko-full-belly": "Morpeko",
    "urshifu-single-strike": "Urshifu", "basculegion-male": "Basculegion",
    "enamorus-incarnate": "Enamorus", "oinkologne-male": "Oinkologne",
    "maushold-family-of-four": "Maushold", "squawkabilly-green-plumage": "Squawkabilly",
    "palafin-zero": "Palafin", "tatsugiri-curly": "Tatsugiri",
    "dudunsparce-two-segment": "Dudunsparce", "great-tusk": "Great Tusk",
    "scream-tail": "Scream Tail", "brute-bonnet": "Brute Bonnet",
    "flutter-mane": "Flutter Mane", "slither-wing": "Slither Wing",
    "sandy-shocks": "Sandy Shocks", "iron-treads": "Iron Treads",
    "iron-bundle": "Iron Bundle", "iron-hands": "Iron Hands",
    "iron-jugulis": "Iron Jugulis", "iron-moth": "Iron Moth",
    "iron-thorns": "Iron Thorns", "wo-chien": "Wo-Chien", "chien-pao": "Chien-Pao",
    "ting-lu": "Ting-Lu", "chi-yu": "Chi-Yu", "roaring-moon": "Roaring Moon",
    "iron-valiant": "Iron Valiant", "walking-wake": "Walking Wake",
    "iron-leaves": "Iron Leaves", "gouging-fire": "Gouging Fire",
    "raging-bolt": "Raging Bolt", "iron-boulder": "Iron Boulder",
    "iron-crown": "Iron Crown",
}


def fetch_csv(name):
    with urllib.request.urlopen(f"{CSV_BASE}/{name}.csv", timeout=60) as r:
        return list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))


def display_name(identifier):
    if identifier in SPECIAL:
        return SPECIAL[identifier]
    return "-".join(part.capitalize() for part in identifier.split("-"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sprites", action="store_true", help="also re-download every sprite")
    args = ap.parse_args()

    generation = {int(r["id"]): int(r["generation_id"]) for r in fetch_csv("pokemon_species")}

    types = {}
    for r in fetch_csv("pokemon_types"):
        types.setdefault(int(r["pokemon_id"]), []).append((int(r["slot"]), TYPE_IDS[int(r["type_id"])]))

    out = []
    for r in fetch_csv("pokemon"):
        pid = int(r["id"])
        # is_default skips the alternate forms (megas, regionals, Rotom appliances):
        # they share a dex number, and a quiz that asks about both is just confusing.
        if pid > MAX_ID or r["is_default"] != "1":
            continue
        out.append({
            "id": pid,
            "name": display_name(r["identifier"]),
            "gen": generation[int(r["species_id"])],
            "types": [name for _, name in sorted(types[pid])],
        })

    out.sort(key=lambda p: p["id"])
    if len(out) != MAX_ID:
        raise SystemExit(f"expected {MAX_ID} Pokemon, built {len(out)} - is MAX_ID stale?")

    # One Pokemon per line: compact, but a diff still shows what changed.
    body = ",\n".join(json.dumps(p, ensure_ascii=False, separators=(",", ":")) for p in out)
    (APP / "data" / "pokemon.json").write_text(f"[\n{body}\n]\n", encoding="utf-8")
    print(f"wrote data/pokemon.json ({len(out)} Pokemon)")

    if args.sprites:
        sprites = APP / "sprites"
        sprites.mkdir(exist_ok=True)
        for p in out:
            target = sprites / f"{p['id']}.png"
            with urllib.request.urlopen(f"{SPRITE_BASE}/{p['id']}.png", timeout=60) as r:
                target.write_bytes(r.read())
        print(f"wrote {len(out)} sprites")
    else:
        missing = [p["id"] for p in out if not (APP / "sprites" / f"{p['id']}.png").exists()]
        if missing:
            print(f"WARNING: {len(missing)} sprites missing, e.g. {missing[:5]} - rerun with --sprites")


if __name__ == "__main__":
    main()
