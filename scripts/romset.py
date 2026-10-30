#!/usr/bin/env python3
"""Romset helper for every game in web/games/. Standard library only.

  romset.py manifest DAT SET        Print the file list for SET (and its BIOS)
                                    from an FBNeo ClrMame Pro XML DAT, ready to
                                    paste into web/games/<SET>.json.
  romset.py merge GAME ZIP [ZIP...] [-o OUT]
                                    Build one self-contained zip for GAME from any
                                    mix of zips (clone + parent, as Fightcade ships
                                    them). Files are matched by size + CRC32, so
                                    renamed files are fine. Writes roms/<file> by
                                    default and never replaces a good file with a
                                    bad merge.
  romset.py verify GAME ZIP         Check a zip against GAME's manifest.
  romset.py bios GAME ZIP [-o OUT]  Verify (and copy) the BIOS zip GAME needs, e.g.
                                    neogeo.zip for Neo Geo games.
  romset.py add DAT SET [--name N] [--short S] [--aliases a,b] [--layout six|neo]
                                    Write web/games/SET.json with the manifest from the
                                    DAT, default buttons for the layout (six = Capcom
                                    style LP MP HP / LK MK HK, neo = A B C D), pinned
                                    core options and the next free netplayId, and add
                                    SET to web/games/index.json.

GAME is a game id from web/games/index.json (e.g. sfiii3nr1, ssf2xjr1, kof2002)
or a path to a game JSON file.

The FBNeo arcade DAT lives in the libretro/FBNeo repository:
  dats/FinalBurn Neo (ClrMame Pro XML, Arcade only).dat
"""
import json, os, shutil, sys, tempfile, zipfile
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMES = os.path.join(ROOT, "web", "games")


def load_game(ref):
    path = ref if ref.endswith(".json") else os.path.join(GAMES, ref + ".json")
    if not os.path.exists(path):
        known = json.load(open(os.path.join(GAMES, "index.json")))["games"]
        sys.exit(f"unknown game {ref!r}; known: {', '.join(known)}")
    return json.load(open(path))


def members(spec):
    return {m["name"]: (m["size"], int(m["crc32"], 16)) for m in spec["members"]}


# ---------- manifest ----------
def cmd_manifest(dat, name):
    root = ET.parse(dat).getroot()
    find = lambda n: root.find(f"./game[@name='{n}']")
    g = find(name)
    if g is None:
        sys.exit(f"{name} not in {dat}")
    romof = g.get("romof")
    bios = find(romof) if romof else None
    bios_is_bios = bios is not None and bios.get("isbios") == "yes"
    bios_names = {r.get("name") for r in bios.findall("rom")} if bios_is_bios else set()
    game_roms, bios_roms = [], []
    for r in g.findall("rom"):
        if r.get("status") == "nodump":
            continue
        entry = {"name": r.get("name"), "size": int(r.get("size")), "crc32": r.get("crc").lower()}
        # Entries merged from a BIOS set live in the BIOS zip; entries merged from
        # a parent game belong in the self-contained game zip.
        (bios_roms if bios_is_bios and r.get("merge") in bios_names else game_roms).append(entry)
    out = {
        "rom": {
            "file": name + ".zip",
            "description": g.findtext("description"),
            "parent": g.get("cloneof"),
            "merged": bool(g.get("cloneof")),
            "members": game_roms,
        }
    }
    if bios_is_bios:
        out["bios"] = {
            "id": romof, "file": romof + ".zip",
            "members": [{"name": r.get("name"), "size": int(r.get("size")), "crc32": r.get("crc").lower()}
                        for r in bios.findall("rom")],
        }
    print(json.dumps(out, indent=2))


# ---------- add a game ----------
# Keyboard: punches top row (U I O), kicks bottom row (J K L).
# Pad / Xbox-mode arcade stick: top row X Y RB, bottom row A B RT.
# Keys are RetroPad indices as EmulatorJS numbers them; the FBNeo mapping was
# verified on the CPS-2, CPS-3 and Neo Geo boards' own input tests.
LAYOUTS = {
    "six": {
        "1":  ("u", "BUTTON_3", "LP"), "9":  ("i", "BUTTON_4", "MP"), "10": ("o", "RIGHT_TOP_SHOULDER", "HP"),
        "0":  ("j", "BUTTON_1", "LK"), "8":  ("k", "BUTTON_2", "MK"), "11": ("l", "RIGHT_BOTTOM_SHOULDER", "HK"),
    },
    "neo": {
        "0": ("u", "BUTTON_3", "A (LP)"), "1": ("i", "BUTTON_4", "C (HP)"),
        "8": ("j", "BUTTON_1", "B (LK)"), "9": ("k", "BUTTON_2", "D (HK)"),
    },
}
COMMON_INPUT = {
    "2": ("space", "SELECT", "Coin"), "3": ("enter", "START", "Start"),
    "4": ("up arrow", "DPAD_UP", "Up"), "5": ("down arrow", "DPAD_DOWN", "Down"),
    "6": ("left arrow", "DPAD_LEFT", "Left"), "7": ("right arrow", "DPAD_RIGHT", "Right"),
}


def build_game(dat, name, title=None, short=None, aliases=None, layout=None, netplay_id=None):
    root = ET.parse(dat).getroot()
    g = root.find(f"./game[@name='{name}']")
    if g is None:
        sys.exit(f"{name} not in {dat}")
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        cmd_manifest(dat, name)
    m = json.loads(buf.getvalue())
    board = (g.findtext("manufacturer") or "")
    if layout is None:
        layout = "neo" if m.get("bios", {}).get("id") == "neogeo" else "six"
    desc = g.findtext("description") or name
    game = {
        "id": name,
        "name": title or desc.split(" (")[0],
        "short": short or (title or desc.split(" (")[0])[:20],
        "aliases": aliases or [],
        "hardware": "Neo Geo" if layout == "neo" else (board or "Arcade"),
        "core": "arcade",
        "netplayId": netplay_id,
        "rom": m["rom"],
    }
    if "bios" in m:
        game["bios"] = {**m["bios"], "label": "Neo Geo BIOS" if m["bios"]["id"] == "neogeo" else m["bios"]["id"] + " BIOS"}
        if m["bios"]["id"] == "neogeo":
            game["bios"]["required"] = ["sp-s2.sp1", "sm1.sm1", "sfix.sfix", "000-lo.lo"]
    game["coreOpts"] = {"fbneo-cpu-speed-adjust": "100%", "fbneo-frameskip-type": "disabled", "fbneo-diagnostic-input": "None"}
    game["input"] = {i: {"key": k, "pad": p, "label": lbl} for i, (k, p, lbl) in {**LAYOUTS[layout], **COMMON_INPUT}.items()}
    game["netplay"] = {"defaultInputDelay": 3, "players": 2}
    game["performance"] = {"fps": 59.2 if layout == "neo" else 60, "warnBelowFps": 50}
    return game


def cmd_add(dat, name, opts):
    idx_path = os.path.join(GAMES, "index.json")
    idx = json.load(open(idx_path))
    used = [json.load(open(os.path.join(GAMES, gid + ".json")))["netplayId"] for gid in idx["games"]]
    game = build_game(dat, name, opts.get("--name"), opts.get("--short"),
                      [a for a in (opts.get("--aliases") or "").split(",") if a], opts.get("--layout"),
                      max(used + [32]) + 1)
    out = os.path.join(GAMES, name + ".json")
    if os.path.exists(out):
        sys.exit(f"{out} already exists")
    json.dump(game, open(out, "w"), indent=2)
    if name not in idx["games"]:
        idx["games"].append(name)
        json.dump(idx, open(idx_path, "w"), indent=2)
    print(f"wrote {out} ({len(game['rom']['members'])} files"
          + (f" + {game['bios']['file']}" if "bios" in game else "")
          + f", layout {'neo' if game['hardware'] == 'Neo Geo' else 'six'}, netplayId {game['netplayId']}) and added it to index.json")
    print("check: name/short/aliases, hardware, coreOpts (region DIP switches), then romset.py merge/verify and boot it")


# ---------- merge / verify ----------
def collect(zips, wanted):
    """name -> bytes for every wanted member found (by size+crc) in any zip, first zip wins."""
    by_sig = {sig: name for name, sig in wanted.items()}
    found = {}
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            for info in zf.infolist():
                sig = (info.file_size, info.CRC)
                name = by_sig.get(sig)
                if name and name not in found:
                    found[name] = zf.read(info.filename)
    return found


def verify_zip(path, wanted, required=None):
    with zipfile.ZipFile(path) as z:
        have = {(i.file_size, i.CRC) for i in z.infolist()}
        bad = z.testzip()
    need = wanted if required is None else {n: wanted[n] for n in required}
    missing = [n for n, sig in need.items() if sig not in have]
    return missing, bad


def write_verified(found, wanted, out, required=None):
    names = list(wanted) if required is None else [n for n in wanted if n in found]
    out_dir = os.path.dirname(out) or "."
    os.makedirs(out_dir, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".merge-", suffix=".zip", dir=out_dir)
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zo:
            for n in names:
                zo.writestr(n, found[n], compress_type=zipfile.ZIP_DEFLATED)
        missing, bad = verify_zip(tmp, wanted, required)
        if missing or bad:
            raise SystemExit(f"merged archive failed verification: missing {missing}, corrupt {bad}")
        os.chmod(tmp, 0o644)
        shutil.move(tmp, out)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def cmd_merge(game_ref, zips, out):
    game = load_game(game_ref)
    wanted = members(game["rom"])
    found = collect(zips, wanted)
    missing = [n for n in wanted if n not in found]
    if missing:
        sys.exit(f"{game['id']}: no valid copy of {len(missing)} file(s): {', '.join(missing[:12])}"
                 + (" ..." if len(missing) > 12 else "")
                 + (f"\nhint: the parent set is {game['rom']['parent']}.zip" if game["rom"].get("parent") else ""))
    out = out or os.path.join(ROOT, "roms", game["rom"]["file"])
    write_verified(found, wanted, out)
    print(f"wrote {out}: {len(wanted)} files verified against the FBNeo manifest, {os.path.getsize(out) / 1048576:.1f} MB")


def cmd_verify(game_ref, path):
    game = load_game(game_ref)
    missing, bad = verify_zip(path, members(game["rom"]))
    if missing or bad:
        sys.exit(f"{path}: missing {len(missing)} file(s) {missing[:12]}" + (f", corrupt {bad}" if bad else ""))
    print(f"{path}: complete {game['id']} set ({len(game['rom']['members'])} files)")


def cmd_bios(game_ref, path, out):
    game = load_game(game_ref)
    bios = game.get("bios")
    if not bios:
        sys.exit(f"{game['id']} needs no BIOS")
    wanted = members(bios)
    missing, bad = verify_zip(path, wanted, bios.get("required"))
    if missing or bad:
        sys.exit(f"{path}: BIOS is missing {missing}" + (f", corrupt {bad}" if bad else ""))
    if out is not False:
        dest = out or os.path.join(ROOT, "roms", bios["file"])
        if os.path.abspath(dest) != os.path.abspath(path):
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copyfile(path, dest)
            os.chmod(dest, 0o644)
            print(f"copied to {dest}")
    print(f"{path}: BIOS has the files {game['id']} needs")


def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__); return
    cmd, args = argv[1], argv[2:]
    out = None
    if "-o" in args:
        i = args.index("-o"); out = args[i + 1]; del args[i:i + 2]
    if cmd == "manifest" and len(args) == 2:
        cmd_manifest(*args)
    elif cmd == "merge" and len(args) >= 2:
        cmd_merge(args[0], args[1:], out)
    elif cmd == "verify" and len(args) == 2:
        cmd_verify(*args)
    elif cmd == "bios" and len(args) == 2:
        cmd_bios(args[0], args[1], out)
    elif cmd == "add" and len(args) >= 2:
        flags = {}
        rest = args[2:]
        for i in range(0, len(rest) - 1, 2):
            flags[rest[i]] = rest[i + 1]
        cmd_add(args[0], args[1], flags)
    else:
        print(__doc__); sys.exit(2)


if __name__ == "__main__":
    main(sys.argv)
