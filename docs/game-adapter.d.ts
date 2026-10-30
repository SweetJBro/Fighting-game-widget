/**
 * Proposed GameAdapter interface (Phase 2). Not wired in yet.
 *
 * Everything 3rd-Strike-specific that today lives in web/js/netplay-bridge.js,
 * web/js/romstore.js, server/serve.js and scripts/merge-romset.py moves behind
 * one of these, so the lobby, the Matrix events and the netplay layer only ever
 * see `adapter.id`. Plain JSON-compatible data wherever possible so adapters can
 * ship as `web/games/<id>.json` plus an optional `<id>.js` for hooks.
 */

/** RetroPad button indices used by EmulatorJS's simulateInput. */
export type RetroPadIndex =
  | 0 /* B */ | 1 /* Y */ | 2 /* SELECT */ | 3 /* START */
  | 4 /* UP */ | 5 /* DOWN */ | 6 /* LEFT */ | 7 /* RIGHT */
  | 8 /* A */ | 9 /* X */ | 10 /* L */ | 11 /* R */
  | 12 /* L2 */ | 13 /* R2 */ | 14 /* L3 */ | 15 /* R3 */;

/** One expected file inside the romset, as listed by the emulator's driver. */
export interface RomMember {
  name: string;
  size: number;
  /** CRC32 as an unsigned integer, e.g. 0x1edc6366. */
  crc32: number;
}

export interface RomSpec {
  /** File name FBNeo/MAME looks for, e.g. "sfiii3nr1.zip". Must not be renamed. */
  file: string;
  /** Other set names the user may drop that resolve to this game. */
  aliases?: string[];
  /**
   * true when the browser needs one self-contained zip (EmulatorJS cannot keep
   * a parent zip intact). The upload path then rejects clone-only sets.
   */
  merged: boolean;
  /** Parent set the clone borrows from, for merge helpers and error messages. */
  parent?: string;
  /** Anything smaller is treated as a split/partial set. */
  minSize: number;
  /** Full manifest; enables in-browser verification and the merge helper. */
  members?: RomMember[];
  /** Human label shown next to the ROM badge, e.g. "Japan 990512 NO CD". */
  versionLabel?: string;
  /** Command shown in ROM errors, e.g. "python3 scripts/merge-romset.py sfiii3nr1 ...". */
  mergeHint?: string;
}

/** Keyboard key name (EmulatorJS keyMap value) and gamepad label per RetroPad index. */
export interface InputBinding {
  key: string;
  pad?: string;
  /** Shown in the Controls help, e.g. "LP". */
  label: string;
}

/** Netplay is host streaming only: the host runs the game, others send inputs or watch. */
export interface NetplaySpec {
  /** Host input delay in frames (0-8). */
  defaultInputDelay: number;
  /** Players per match (fighting games: 2). Extra netplay seats become spectators. */
  players: number;
  maxSpectators?: number;
}

export interface PerformanceSpec {
  /** Native refresh rate, e.g. 59.6 for CPS-3. */
  fps: number;
  /** Below this sustained host fps the warning banner shows. */
  warnBelowFps: number;
  /** Measured save-state size in bytes (instant rematch keeps one in memory). */
  stateBytes?: number;
}

export interface GameAdapter {
  /** Driver / romset id, also the Matrix event `game` field. */
  id: string;
  name: string;
  /** EmulatorJS core name ("fbneo", "mame2003_plus", ...). */
  core: string;
  rom: RomSpec;
  /** Passed straight to EJS_coreOpts. */
  coreOpts: Record<string, string>;
  /** Player 1 bindings; P2 comes from the remote side in streaming mode. */
  defaultInputMap: Partial<Record<RetroPadIndex, InputBinding>>;
  netplay: NetplaySpec;
  performance: PerformanceSpec;
  /** Optional hooks for games that need more than data. */
  hooks?: {
    /** Extra checks on the dropped file before it is stored. */
    validateRom?(file: File): Promise<string | null>;
    /** Runs once the core has started, e.g. to set DIP switches not exposed as core options. */
    onGameStart?(emulator: unknown): void;
  };
}

/** The registry the lobby reads; Matrix challenge events carry `game: adapter.id`. */
export interface GameRegistry {
  list(): GameAdapter[];
  get(id: string): GameAdapter | undefined;
}

/** What sfiii3nr1 would look like (abridged manifest). */
export declare const sfiii3nr1: GameAdapter;
/*
{
  id: "sfiii3nr1",
  name: "Street Fighter III: 3rd Strike",
  core: "fbneo",
  rom: {
    file: "sfiii3nr1.zip", aliases: ["sfiii3n.zip", "sfiii3r1.zip", "sfiii3.zip"],
    merged: true, parent: "sfiii3", minSize: 60 * 1024 * 1024,
    versionLabel: "Japan 990512 NO CD, the set Fightcade runs",
    members: [{ name: "sfiii3_japan_nocd.29f400.u2", size: 0x80000, crc32: 0x1edc6366 }, ...40 flash],
    mergeHint: "python3 scripts/merge-romset.py <sfiii3nr1.zip> <sfiii3.zip>"
  },
  coreOpts: {
    "fbneo-dipswitch-sfiii3nr1-Region": "Japan",
    "fbneo-cpu-speed-adjust": "100%",
    "fbneo-frameskip-type": "disabled"
  },
  defaultInputMap: {
    1: { key: "u", pad: "BUTTON_4", label: "LP" }, 9: { key: "i", pad: "BUTTON_3", label: "MP" },
    10: { key: "o", pad: "LEFT_TOP_SHOULDER", label: "HP" }, 0: { key: "j", pad: "BUTTON_2", label: "LK" },
    8: { key: "k", pad: "BUTTON_1", label: "MK" }, 11: { key: "l", pad: "RIGHT_TOP_SHOULDER", label: "HK" },
    2: { key: "space", pad: "SELECT", label: "Coin" }, 3: { key: "enter", pad: "START", label: "Start" },
    4: { key: "up arrow", pad: "DPAD_UP", label: "Up" }, 5: { key: "down arrow", pad: "DPAD_DOWN", label: "Down" },
    6: { key: "left arrow", pad: "DPAD_LEFT", label: "Left" }, 7: { key: "right arrow", pad: "DPAD_RIGHT", label: "Right" }
  },
  netplay: { defaultInputDelay: 3, players: 2, maxSpectators: 2 },
  performance: { fps: 59.6, warnBelowFps: 50, stateBytes: 10295432 }
}
*/
