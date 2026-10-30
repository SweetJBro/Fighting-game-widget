/**
 * Format of web/games/<id>.json, the per-game definition the lobby, ROM store,
 * server, netplay bridge and Fluxer bot all read. web/games/index.json lists the
 * games in picker order and names the default:
 *
 *   { "default": "sfiii3nr1", "games": ["sfiii3nr1", "ssf2xjr1", "kof2002"] }
 *
 * Adding a game:
 *   1. python3 scripts/romset.py manifest "<FBNeo arcade DAT>" <set>  > draft.json
 *      (the DAT is dats/FinalBurn Neo (ClrMame Pro XML, Arcade only).dat in libretro/FBNeo)
 *   2. Wrap the printed rom/bios blocks in a GameDefinition below, pick a unique
 *      netplayId, set coreOpts and input, save as web/games/<set>.json.
 *   3. Add the id to web/games/index.json.
 *   4. python3 scripts/romset.py merge <set> <your zips...>   (or verify) and play.
 * No code changes are needed for another FBNeo arcade game.
 */

/** RetroPad button indices EmulatorJS uses (keys of `input`). */
export type RetroPadIndex =
  | "0" /* B */ | "1" /* Y */ | "2" /* SELECT (coin) */ | "3" /* START */
  | "4" /* UP */ | "5" /* DOWN */ | "6" /* LEFT */ | "7" /* RIGHT */
  | "8" /* A */ | "9" /* X */ | "10" /* L */ | "11" /* R */;

/** One file inside a zip, as FinalBurn Neo's DAT lists it. */
export interface RomMember {
  name: string;
  size: number;
  /** CRC32, lower-case hex without 0x, e.g. "1edc6366". Files are matched by size + CRC. */
  crc32: string;
}

export interface RomSpec {
  /** Set name FBNeo looks for, e.g. "sfiii3nr1.zip". The zip must keep this name. */
  file: string;
  /** DAT description, e.g. "Street Fighter III 3rd Strike: Fight for the Future (Japan 990512, NO CD)". */
  description?: string;
  /** Parent set when this is a clone (Fightcade ships clones split from their parent). */
  parent: string | null;
  /** true when the browser needs one self-contained zip: members include the parent's files. */
  merged: boolean;
  /** Every file the game zip must hold. Checked in the browser before storing and by romset.py. */
  members: RomMember[];
  /** Shown next to the ROM badge and on the ROM screen. */
  versionLabel?: string;
}

/** Shared BIOS zip, e.g. neogeo.zip; stored once per browser and reused by every game on that board. */
export interface BiosSpec {
  id: string;
  file: string;
  label?: string;
  members: RomMember[];
  /** Only these must be present (a BIOS zip carries many optional variants). */
  required?: string[];
}

export interface InputBinding {
  /** EmulatorJS key name, e.g. "u", "space", "up arrow". */
  key: string;
  /** EmulatorJS gamepad label, e.g. "BUTTON_4", "LEFT_TOP_SHOULDER". */
  pad: string;
  /** Shown in the Controls help, e.g. "LP" or "A (LP)". */
  label: string;
}

export interface GameDefinition {
  /** FBNeo set name; also the `game` field on Matrix events and the ?game= link parameter. */
  id: string;
  name: string;
  /** Short name for badges, tags and lobby titles, e.g. "3rd Strike". */
  short: string;
  /** Words the Fluxer bot and ?game= accept, e.g. ["3s", "sf3"]. */
  aliases?: string[];
  /** Board name for messages, e.g. "CPS-3", "Neo Geo". */
  hardware: string;
  /** EmulatorJS core; "arcade" is FBNeo. */
  core: string;
  /** Room namespace on the netplay server; unique per game. 3rd Strike keeps 33. */
  netplayId: number;
  rom: RomSpec;
  bios?: BiosSpec;
  /** Passed straight to EJS_coreOpts, e.g. { "fbneo-dipswitch-sfiii3nr1-Region": "Japan" }. */
  coreOpts: Record<string, string>;
  /** Player 1 bindings. Player 2 comes from the remote side. */
  input: Partial<Record<RetroPadIndex, InputBinding>>;
  netplay: {
    /** Host input delay in frames (0-8) until a player picks one; INPUT_DELAY_DEFAULT overrides. */
    defaultInputDelay: number;
    players: number;
  };
  performance: {
    /** Native refresh rate. */
    fps: number;
    /** Below this sustained host fps the warning banner shows. */
    warnBelowFps: number;
  };
}

/** web/games/index.json */
export interface GameIndex {
  default: string;
  games: string[];
}
