#!/usr/bin/env node
/* Fluxer matchmaking bot. Zero dependencies, Node 22+ (built-in WebSocket + fetch).

   Commands (in any channel the bot can read):
     !fight @someone      challenge a specific person; bot posts a host link for you and a join link for them
     !fight               open challenge; bot posts a host link for you and a join link for anyone
     !fight kof @someone  pick the game by id or alias (st, 3s, kof, ...); default is the lobby's default game
     !fight watch CODE    watch link for a match code (also: !watch CODE, !watch kof CODE)
     !fight status        netplay server reachability and the open matches, from the lobby's /status.json (also: !status)
     !fight help          lists the commands and games with their aliases (also: !help when PREFIX is !fight)

   Env:
     FLUXER_BOT_TOKEN   bot token from your Fluxer application ("<application_id>.<secret>")
     LOBBY_URL          public URL of the lobby page, e.g. https://3s.example.com/
     FLUXER_INSTANCE    base of the instance for discovery (default https://fluxer.app)
     FLUXER_API_BASE    override API base (default from /.well-known/fluxer -> endpoints.api_public)
     FLUXER_GATEWAY     override gateway URL (default from discovery -> endpoints.gateway)
     PREFIX             command prefix (default "!fight") */
"use strict";

const TOKEN = process.env.FLUXER_BOT_TOKEN;
const LOBBY_URL = process.env.LOBBY_URL;
const PREFIX = (process.env.PREFIX || "!fight").toLowerCase();
const INSTANCE = (process.env.FLUXER_INSTANCE || "https://fluxer.app").replace(/\/$/, "");
if (!process.env.BOT_SELFTEST && (!TOKEN || !LOBBY_URL)) { console.error("Set FLUXER_BOT_TOKEN and LOBBY_URL"); process.exit(1); }

/* ---- games: read from the lobby itself (web/games), so the bot never drifts ---- */
let GAMES = [{ id: "sfiii3nr1", name: "Street Fighter III: 3rd Strike", short: "3rd Strike", aliases: ["3s", "sf3"] }];
let DEFAULT_GAME = "sfiii3nr1";
async function loadGames() {
  try {
    const base = new URL("games/", LOBBY_URL);
    const idx = await (await fetch(new URL("index.json", base))).json();
    GAMES = await Promise.all(idx.games.map(async (id) => (await fetch(new URL(id + ".json", base))).json()));
    DEFAULT_GAME = idx.default || GAMES[0].id;
    console.log("games:", GAMES.map((g) => g.id).join(", "));
  } catch (e) { console.error("could not load games from the lobby, using 3rd Strike only:", e.message); }
}
function findGame(word) {
  const w = String(word || "").toLowerCase();
  return GAMES.find((g) => g.id === w || (g.aliases || []).includes(w)) || null;
}
const CODE_RE = /^[A-Z]+-[A-Z0-9]{4}$/i;
const defaultGame = () => GAMES.find((g) => g.id === DEFAULT_GAME) || GAMES[0];
/** "kof <@123> extra" -> { game } | { help } | { status } | { watch: CODE, game } | { unknown }; mentions are handled separately. */
export function parseArgs(arg) {
  const words = arg.split(/\s+/).filter((w) => w && !/^<@!?\d+>$/.test(w));
  if (!words.length) return { game: defaultGame() };
  if (words[0] === "help") return { help: true };
  if (words[0] === "status") return { status: true };
  if (words[0] === "watch") {
    const rest = words.slice(1);
    const code = rest.find((w) => CODE_RE.test(w));
    const gameWord = rest.find((w) => !CODE_RE.test(w));
    const game = gameWord ? findGame(gameWord) : defaultGame();
    if (gameWord && !game) return { unknown: gameWord };
    if (!code) return { watchMissingCode: true };
    return { watch: code.toUpperCase(), game };
  }
  const game = findGame(words[0]);
  if (!game) return { unknown: words[0] };
  return { game };
}
/** Bare "!watch ..." / "!status" / "!help" are the same as "!fight watch ..." etc. */
export function commandText(text, prefix) {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (lower.startsWith(prefix)) return t.slice(prefix.length).trim();
  for (const bare of ["!watch", "!status", "!help"]) {
    if (lower === bare || lower.startsWith(bare + " ")) return bare.slice(1) + t.slice(bare.length);
  }
  return null;
}
export function helpText(prefix, games) {
  const list = games.map((g) => "`" + g.id + "` " + g.name + (g.aliases && g.aliases.length ? " (" + g.aliases.map((a) => "`" + a + "`").join(", ") + ")" : "")).join("\n");
  return "**Fighting Game Widget**\n" +
    "`" + prefix + " @player` challenge someone · `" + prefix + "` open challenge · `" + prefix + " <game> @player` another game\n" +
    "`" + prefix + " watch CODE` watch a match · `" + prefix + " status` who is playing · `" + prefix + " help` this\n" +
    "Games (use the id or an alias):\n" + list + "\n" +
    "Only the host needs the game's files; joining and watching need nothing.";
}
/** Reads the lobby's /status.json into one message. */
export function statusText(st) {
  const lines = [st.netplay.reachable ? "Netplay server: up (" + st.netplay.ms + " ms from the lobby)" : "Netplay server: **unreachable** from the lobby at " + st.netplay.url];
  let any = false;
  for (const g of st.games || []) {
    if (!g.rooms || !g.rooms.length) continue;
    any = true;
    lines.push("**" + g.name + "**: " + g.rooms.map((r) => "`" + r.name + "` hosted by " + r.host + " (" + r.players + "/" + r.max + (r.players < 2 ? ", waiting for an opponent" : "") + ")").join(" · "));
  }
  if (!any) lines.push("No open matches right now. `" + PREFIX + "` to start one.");
  return lines.join("\n");
}

const CHARS = ["RYU", "KEN", "CHUN", "YUN", "YANG", "MAKOTO", "DUDLEY", "URIEN", "AKUMA", "ORO", "IBUKI", "ELENA", "ALEX", "REMY", "NECRO", "HUGO", "SEAN", "TWELVE", "GILL"];
function makeCode() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return CHARS[Math.floor(Math.random() * CHARS.length)] + "-" + s;
}
function link(code, role, game) {
  const u = new URL(LOBBY_URL); u.searchParams.set("match", code); u.searchParams.set("role", role);
  u.searchParams.set("game", game.id); return u.toString();
}

let API = process.env.FLUXER_API_BASE, GATEWAY = process.env.FLUXER_GATEWAY;
async function discover() {
  if (API && GATEWAY) return;
  const r = await fetch(INSTANCE + "/.well-known/fluxer");
  if (!r.ok) throw new Error("discovery failed: " + r.status);
  const d = await r.json();
  API = API || d.endpoints.api_public;
  GATEWAY = GATEWAY || d.endpoints.gateway;
}
async function api(method, path, body) {
  const r = await fetch(API.replace(/\/$/, "") + "/v1" + path, {
    method, headers: { authorization: "Bot " + TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(method + " " + path + " -> " + r.status + " " + (await r.text()).slice(0, 300));
  return r.status === 204 ? null : r.json();
}
function post(channelId, content, userIds) {
  return api("POST", `/channels/${channelId}/messages`, {
    content, allowed_mentions: { users: userIds || [] }, nonce: String(Date.now())
  }).catch((e) => console.error("send failed:", e.message));
}

let me = null;
async function onMessage(m) {
  if (!m || !m.content || (m.author && (m.author.bot || (me && m.author.id === me.id)))) return;
  const arg = commandText(m.content, PREFIX);
  if (arg === null) return;
  const author = m.author || {};
  const authorName = author.global_name || author.username || "someone";

  const parsed = parseArgs(arg.toLowerCase());
  if (parsed.help || parsed.unknown) {
    return post(m.channel_id, (parsed.unknown ? `Unknown game \`${parsed.unknown}\`.\n` : "") + helpText(PREFIX, GAMES));
  }
  if (parsed.watchMissingCode) return post(m.channel_id, `Which match? \`${PREFIX} watch RYU-7F3K\` (the code is in the challenge message).`);
  if (parsed.watch) {
    return post(m.channel_id, `👀 Watch **${parsed.watch}** (${parsed.game.name}): ${link(parsed.watch, "spectator", parsed.game)}`);
  }
  if (parsed.status) {
    try {
      const st = await (await fetch(new URL("status.json", LOBBY_URL), { signal: AbortSignal.timeout(5000) })).json();
      return post(m.channel_id, statusText(st));
    } catch (e) { return post(m.channel_id, "Could not read the lobby's status page: " + e.message); }
  }
  const game = parsed.game;
  const code = makeCode();
  const target = (m.mentions || []).find((u) => u.id !== author.id && !(me && u.id === me.id));
  if (target) {
    const tName = target.global_name || target.username || "opponent";
    await post(m.channel_id,
      `🥊 **${authorName}** challenges **${tName}** to ${game.name} — match **${code}**\n` +
      `<@${author.id}> host (P1): ${link(code, "host", game)}\n` +
      `<@${target.id}> join (P2): ${link(code, "guest", game)}\n` +
      `Watch: ${link(code, "spectator", game)}`,
      [author.id, target.id]);
  } else {
    await post(m.channel_id,
      `🥊 **${authorName}** is looking for a ${game.name} fight — match **${code}**\n` +
      `<@${author.id}> host (P1): ${link(code, "host", game)}\n` +
      `Anyone, join (P2): ${link(code, "guest", game)}\n` +
      `Watch: ${link(code, "spectator", game)}`,
      [author.id]);
  }
}

/* ---- gateway ---- */
let ws, seq = null, hb = null, sessionId = null, backoff = 1000;
function connect() {
  const url = GATEWAY.replace(/\/$/, "") + "/?v=1&encoding=json";
  console.log("connecting", url);
  ws = new WebSocket(url);
  ws.onopen = () => { backoff = 1000; };
  ws.onmessage = (ev) => {
    let p; try { p = JSON.parse(ev.data); } catch { return; }
    if (p.s != null) seq = p.s;
    switch (p.op) {
      case 10: // HELLO
        clearInterval(hb);
        hb = setInterval(() => send({ op: 1, d: seq }), p.d.heartbeat_interval);
        if (sessionId) send({ op: 6, d: { token: TOKEN, session_id: sessionId, seq } });
        else send({ op: 2, d: { token: TOKEN, properties: { os: process.platform, browser: "3s-lobby-bot", device: "server" } } });
        break;
      case 1: send({ op: 1, d: seq }); break;               // server asks for a heartbeat
      case 7: ws.close(4000, "reconnect requested"); break; // RECONNECT
      case 9: sessionId = null; setTimeout(() => ws.close(4000, "invalid session"), 1000); break;
      case 0: // DISPATCH
        if (p.t === "READY") { sessionId = p.d.session_id; me = p.d.user; console.log("ready as", me && me.username); }
        else if (p.t === "MESSAGE_CREATE") onMessage(p.d).catch((e) => console.error(e));
        break;
      default: break;
    }
  };
  ws.onclose = (ev) => {
    clearInterval(hb);
    if (ev.code === 4004) { console.error("invalid bot token (4004)"); process.exit(1); }
    console.log("gateway closed", ev.code, ev.reason, "- reconnecting in", backoff, "ms");
    setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 60000);
  };
  ws.onerror = (e) => console.error("gateway error", e.message || e);
}
function send(o) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); }

if (!process.env.BOT_SELFTEST) {
  loadGames().then(discover).then(connect).catch((e) => { console.error(e); process.exit(1); });
}
export { loadGames, findGame };
