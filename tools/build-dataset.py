#!/usr/bin/env python3
"""Rebuild app/data/*.json and app/sprites/ from PokeAPI.

All of it is checked in, so this only needs running when a new generation lands.
It reads the CSV sources rather than the REST API: a handful of requests instead
of a thousand, and the same data.

    python3 tools/build-dataset.py            # data only
    python3 tools/build-dataset.py --sprites  # data + re-download every sprite

Writes three files:

    pokemon.json    id, name, generation, types, base stats, abilities
    moves.json      the damaging moves a damage calculator can be honest about
    learnsets.json  pokemon id -> the move ids it can actually learn
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

# stats.csv ids, in the order the app stores them.
STAT_ORDER = [1, 2, 3, 4, 5, 6]   # hp, attack, defense, sp. attack, sp. defense, speed

DAMAGE_CLASSES = {2: "physical", 3: "special"}   # 1 is status - no damage to model

# Moves whose type is not a property of the move.
#
# The CSV gives each of these a nominal type - almost always Normal - but in
# game it comes from something the quiz does not show: the user's IVs, a held
# Plate, Drive, Memory or mask, the weather, the terrain, the user's form, or a
# Terastal type. Ultra asks the player to infer the type from the move's name,
# and Master feeds it into STAB and the type chart, so a move whose real type is
# unknowable makes both modes unanswerable rather than hard.
VARIABLE_TYPE = {
    "hidden-power",       # from the user's IVs
    "weather-ball",       # from the weather
    "terrain-pulse",      # from the terrain
    "judgment",           # from Arceus's Plate
    "techno-blast",       # from Genesect's Drive
    "multi-attack",       # from Silvally's Memory
    "ivy-cudgel",         # from Ogerpon's mask
    "revelation-dance",   # from Oricorio's primary type
    "aura-wheel",         # from Morpeko's form
    "raging-bull",        # from Tauros's form
    "tera-blast",         # from the user's Terastal type
    "tera-starstorm",     # from the user's Terastal type
}

ENGLISH = "9"   # languages.csv: local_language_id for en

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

    # Base stats, for Master mode's damage calculation.
    stats = {}
    for r in fetch_csv("pokemon_stats"):
        pid, sid = int(r["pokemon_id"]), int(r["stat_id"])
        if pid <= MAX_ID and sid in STAT_ORDER:
            stats.setdefault(pid, {})[sid] = int(r["base_stat"])
    for p in out:
        row = stats[p["id"]]
        p["stats"] = [row[sid] for sid in STAT_ORDER]

    # Abilities, for Master mode. Every slot including the hidden one: the mode
    # picks one at random and shows it, so an attacker with Levitate is a fair
    # question rather than a trick.
    ability_names = {int(r["ability_id"]): r["name"] for r in fetch_csv("ability_names")
                     if r["local_language_id"] == ENGLISH}
    abilities = {}
    for r in fetch_csv("pokemon_abilities"):
        pid = int(r["pokemon_id"])
        if pid <= MAX_ID:
            abilities.setdefault(pid, []).append((int(r["slot"]), ability_names[int(r["ability_id"])]))
    for p in out:
        slots = sorted(abilities.get(p["id"], []))
        # Duplicate slots exist (a hidden ability equal to the normal one).
        seen = []
        for _, name in slots:
            if name not in seen:
                seen.append(name)
        p["abilities"] = seen

    write_json("pokemon.json", out)
    print(f"wrote data/pokemon.json ({len(out)} Pokemon)")

    moves = build_moves()
    write_json("moves.json", moves)
    print(f"wrote data/moves.json ({len(moves)} moves)")

    learnsets = build_learnsets({m["id"] for m in moves})
    (APP / "data" / "learnsets.json").write_text(
        json.dumps(learnsets, separators=(",", ":")) + "\n", encoding="utf-8")
    pairs = sum(len(v) for v in learnsets.values())
    print(f"wrote data/learnsets.json ({len(learnsets)} Pokemon, {pairs} pairs)")

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


def build_moves():
    """Damaging moves with a fixed type and a fixed, single-hit power.

    Everything else is excluded because the quiz would lie about it: status
    moves deal no damage, OHKO and fixed-damage moves ignore the formula
    entirely (and carry a null power), a multi-hit move's power is per hit so
    one application of the formula understates it by 2-5x, and a move in
    VARIABLE_TYPE has no type the player could work out from its name.
    """
    names = {int(r["move_id"]): r["name"] for r in fetch_csv("move_names")
             if r["local_language_id"] == ENGLISH}
    meta = {int(r["move_id"]): r for r in fetch_csv("move_meta")}

    moves = []
    for r in fetch_csv("moves"):
        mid = int(r["id"])
        cls = DAMAGE_CLASSES.get(int(r["damage_class_id"]))
        if cls is None or not r["power"] or int(r["power"]) <= 0:
            continue
        # Shadow moves (Colosseum/XD) carry type ids outside the main 18.
        if int(r["type_id"]) not in TYPE_IDS:
            continue
        if r["identifier"] in VARIABLE_TYPE:
            continue
        hits = meta.get(mid, {}).get("max_hits")
        if hits and int(hits) > 1:
            continue
        if mid not in names:
            continue
        moves.append({
            "id": mid,
            "name": names[mid],
            "type": TYPE_IDS[int(r["type_id"])],
            "power": int(r["power"]),
            "cls": cls,
            "gen": int(r["generation_id"]),
        })
    moves.sort(key=lambda m: m["id"])
    return moves


def build_learnsets(move_ids):
    """pokemon id -> sorted move ids, across every version group.

    Master mode pairs an attacker with a move, and a Magikarp firing Draco
    Meteor would make the numbers feel arbitrary. Keyed as strings because that
    is what JSON gives back anyway.
    """
    learned = {}
    for r in fetch_csv("pokemon_moves"):
        pid, mid = int(r["pokemon_id"]), int(r["move_id"])
        if pid <= MAX_ID and mid in move_ids:
            learned.setdefault(pid, set()).add(mid)
    return {str(pid): sorted(mids) for pid, mids in sorted(learned.items())}


def write_json(name, rows):
    """One record per line: compact, but a diff still shows what changed."""
    body = ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows)
    (APP / "data" / name).write_text(f"[\n{body}\n]\n", encoding="utf-8")


if __name__ == "__main__":
    main()
