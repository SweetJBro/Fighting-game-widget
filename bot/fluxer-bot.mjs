#!/usr/bin/env node
/* Fluxer matchmaking bot. Zero dependencies, Node 22+ (built-in WebSocket + fetch).

   Commands (in any channel the bot can read):
     !fight @someone      challenge a specific person; bot posts a host link for you and a join link for them
     !fight               open challenge; bot posts a host link for you and a join link for anyone
     !fight help

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
if (!TOKEN || !LOBBY_URL) { console.error("Set FLUXER_BOT_TOKEN and LOBBY_URL"); process.exit(1); }

const CHARS = ["RYU", "KEN", "CHUN", "YUN", "YANG", "MAKOTO", "DUDLEY", "URIEN", "AKUMA", "ORO", "IBUKI", "ELENA", "ALEX", "REMY", "NECRO", "HUGO", "SEAN", "TWELVE", "GILL"];
function makeCode() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return CHARS[Math.floor(Math.random() * CHARS.length)] + "-" + s;
}
function link(code, role) {
  const u = new URL(LOBBY_URL); u.searchParams.set("match", code); u.searchParams.set("role", role); return u.toString();
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
  const text = m.content.trim();
  if (!text.toLowerCase().startsWith(PREFIX)) return;
  const arg = text.slice(PREFIX.length).trim().toLowerCase();
  const author = m.author || {};
  const authorName = author.global_name || author.username || "someone";

  if (arg === "help") {
    return post(m.channel_id, `**3rd Strike Lobby**\n\`${PREFIX} @player\` challenge someone · \`${PREFIX}\` open challenge.\nEach player needs their own 3rd Strike romset loaded once in the lobby page.`);
  }
  const code = makeCode();
  const target = (m.mentions || []).find((u) => u.id !== author.id && !(me && u.id === me.id));
  if (target) {
    const tName = target.global_name || target.username || "opponent";
    await post(m.channel_id,
      `🥊 **${authorName}** challenges **${tName}** — match **${code}**\n` +
      `<@${author.id}> host (P1): ${link(code, "host")}\n` +
      `<@${target.id}> join (P2): ${link(code, "guest")}`,
      [author.id, target.id]);
  } else {
    await post(m.channel_id,
      `🥊 **${authorName}** is looking for a fight — match **${code}**\n` +
      `<@${author.id}> host (P1): ${link(code, "host")}\n` +
      `Anyone, join (P2): ${link(code, "guest")}`,
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

discover().then(connect).catch((e) => { console.error(e); process.exit(1); });
