#!/usr/bin/env python3
"""Build a self-contained sfiii3nr1.zip from a split FBNeo pair as shipped by
Fightcade: sfiii3nr1.zip (clone: its own simm1.0-1.3 + Japan NO-CD BIOS) and
sfiii3.zip (parent: the shared simm2.x-6.x flash). EmulatorJS cannot keep a
parent zip intact in the browser, so the lobby needs one merged archive.

usage: scripts/merge-romset.py <sfiii3nr1.zip> <sfiii3.zip> [out.zip]

Only the Python standard library is needed. Output defaults to roms/sfiii3nr1.zip.
The result is verified file-by-file (name, size, CRC32) against the sfiii3nr1
definition in FBNeo's src/burn/drv/cps3/d_cps3.cpp before it is moved into
place; a bad merge never replaces an existing good file.
"""
import os, re, shutil, sys, tempfile, zipfile

# sfiii3nr1RomDesc: BIOS + SFIII3_990512_FLASH (FBNeo d_cps3.cpp). name -> (size, crc32)
EXPECTED = {
    "sfiii3_japan_nocd.29f400.u2": (0x080000, 0x1edc6366),
    "sfiii3-simm1.0": (0x200000, 0x66e66235), "sfiii3-simm1.1": (0x200000, 0x186e8c5f),
    "sfiii3-simm1.2": (0x200000, 0xbce18cab), "sfiii3-simm1.3": (0x200000, 0x129dc2c9),
    "sfiii3-simm2.0": (0x200000, 0x06eb969e), "sfiii3-simm2.1": (0x200000, 0xe7039f82),
    "sfiii3-simm2.2": (0x200000, 0x645c96f7), "sfiii3-simm2.3": (0x200000, 0x610efab1),
    "sfiii3-simm3.0": (0x200000, 0x7baa1f79), "sfiii3-simm3.1": (0x200000, 0x234bf8fe),
    "sfiii3-simm3.2": (0x200000, 0xd9ebc308), "sfiii3-simm3.3": (0x200000, 0x293cba77),
    "sfiii3-simm3.4": (0x200000, 0x6055e747), "sfiii3-simm3.5": (0x200000, 0x499aa6fc),
    "sfiii3-simm3.6": (0x200000, 0x6c13879e), "sfiii3-simm3.7": (0x200000, 0xcf4f8ede),
    "sfiii3-simm4.0": (0x200000, 0x091fd5ba), "sfiii3-simm4.1": (0x200000, 0x0bca8917),
    "sfiii3-simm4.2": (0x200000, 0xa0fd578b), "sfiii3-simm4.3": (0x200000, 0x4bf8c699),
    "sfiii3-simm4.4": (0x200000, 0x137b8785), "sfiii3-simm4.5": (0x200000, 0x4fb70671),
    "sfiii3-simm4.6": (0x200000, 0x832374a4), "sfiii3-simm4.7": (0x200000, 0x1c88576d),
    "sfiii3-simm5.0": (0x200000, 0xc67d9190), "sfiii3-simm5.1": (0x200000, 0x6cb79868),
    "sfiii3-simm5.2": (0x200000, 0xdf69930e), "sfiii3-simm5.3": (0x200000, 0x333754e0),
    "sfiii3-simm5.4": (0x200000, 0x78f6d417), "sfiii3-simm5.5": (0x200000, 0x8ccad9b1),
    "sfiii3-simm5.6": (0x200000, 0x85de59e5), "sfiii3-simm5.7": (0x200000, 0xee7e29b3),
    "sfiii3-simm6.0": (0x200000, 0x8da69042), "sfiii3-simm6.1": (0x200000, 0x1c8c7ac4),
    "sfiii3-simm6.2": (0x200000, 0xa671341d), "sfiii3-simm6.3": (0x200000, 0x1a990249),
    "sfiii3-simm6.4": (0x200000, 0x20cb39ac), "sfiii3-simm6.5": (0x200000, 0x5f844b2f),
    "sfiii3-simm6.6": (0x200000, 0x450e8d28), "sfiii3-simm6.7": (0x200000, 0xcc5f4187),
}

def pick(zf, name):
    """Return the member's bytes if it exists in zf with the expected size+CRC, else None."""
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if (info.file_size, info.CRC) != EXPECTED[name]:
        return None
    return zf.read(name)

def verify(path):
    problems = []
    with zipfile.ZipFile(path) as z:
        have = {i.filename: (i.file_size, i.CRC) for i in z.infolist()}
        for name, want in EXPECTED.items():
            if name not in have:
                problems.append(f"missing {name}")
            elif have[name] != want:
                problems.append(f"bad size/crc for {name}: {have[name]} != {want}")
        for name in have:
            if name not in EXPECTED:
                problems.append(f"unexpected member {name}")
        bad = z.testzip()
        if bad:
            problems.append(f"corrupt member {bad}")
    return problems

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(2)
    clone, parent = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join("roms", "sfiii3nr1.zip")
    out_dir = os.path.dirname(out) or "."
    os.makedirs(out_dir, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".merge-", suffix=".zip", dir=out_dir)
    os.close(fd)
    try:
        missing = []
        with zipfile.ZipFile(clone) as zc, zipfile.ZipFile(parent) as zp, \
             zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zo:
            for name in EXPECTED:
                # The clone's own copy wins (its simm1.x differ from the parent's);
                # anything it lacks comes from the parent, only if size and CRC match.
                data = pick(zc, name)
                if data is None:
                    data = pick(zp, name)
                if data is None:
                    missing.append(name)
                    continue
                zo.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
        if missing:
            raise SystemExit("no valid copy of: " + ", ".join(missing))
        problems = verify(tmp)
        if problems:
            raise SystemExit("merged archive failed verification:\n  " + "\n  ".join(problems))
        os.chmod(tmp, 0o644)
        shutil.move(tmp, out)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    print(f"wrote {out}: {len(EXPECTED)} files verified against FBNeo d_cps3.cpp, {os.path.getsize(out) / 1048576:.1f} MB")

if __name__ == "__main__":
    main()
