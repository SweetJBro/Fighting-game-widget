#!/usr/bin/env python3
"""Compatibility wrapper: build a self-contained sfiii3nr1.zip from Fightcade's
split pair. Same as `scripts/romset.py merge sfiii3nr1 <clone.zip> <parent.zip>`,
which works for every game in web/games/.

usage: scripts/merge-romset.py <sfiii3nr1.zip> <sfiii3.zip> [out.zip]
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import romset

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(2)
    romset.cmd_merge("sfiii3nr1", sys.argv[1:3], sys.argv[3] if len(sys.argv) > 3 else None)
