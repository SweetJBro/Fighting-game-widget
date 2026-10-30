#!/usr/bin/env node
/* Zero-dependency static server for web/ that also renders /config.json from
   the environment. Node 18+.

   PORT              listen port (default 8080)
   NETPLAY_URL       public URL of the EmulatorJS netplay server (default http://<host>:4000, resolved in the browser)
   ICE_SERVERS       JSON array of RTCIceServer objects
   EJS_DATA_PATH     EmulatorJS data dir (default: ejs/ when scripts/fetch-emulatorjs.sh has
                     installed a pinned copy into web/ejs/, otherwise the "latest" CDN)
   STREAM_FPS              host video capture/encode fps, 15-60 (default 60)
   STREAM_BITRATE_DIRECT   max video bitrate on a direct peer path, bps (default 4000000)
   STREAM_BITRATE_RELAY    max video bitrate through TURN, bps (default 1500000)
   INPUT_DELAY_DEFAULT     host input delay in frames, 0-8, until a player picks one (default 3)
   THREADS=0               never use the threaded core, even in an isolated pop-out tab
   MAX_SPECTATORS          watchers per match, 0-6 (default 2; each costs the host one video encode)
   PUBLIC_URL        public URL of this page (for share links)
   HOST              bind address (default 0.0.0.0; use 127.0.0.1 to keep a dev server off the LAN)
   ROMS_DIR          folder holding romsets for personal use (default ../roms). Any file named
                     like a game's set (web/games/*.json rom.file) or its BIOS (bios.file) counts.
   PACKAGED_ROM=1    serve and advertise those files (opt-in: off unless set, so a checkout with
                     ROMs in roms/ never publishes them by accident) */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "web");
// Personal/private use: a merged sfiii3*.zip placed here is served at /roms/<name>
// and advertised in /config.json so the lobby skips the "bring your own ROM" step.
// The folder is git-ignored and not copied into the Docker image on purpose.
const ROMS_DIR = path.resolve(process.env.ROMS_DIR || path.join(__dirname, "..", "roms"));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".wasm": "application/wasm", ".data": "application/octet-stream", ".ico": "image/x-icon", ".woff2": "font/woff2"
};

/** web/games/*.json, read fresh so adding a game needs no restart. */
function games() {
  const dir = path.join(ROOT, "games");
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
    return idx.games.map((id) => JSON.parse(fs.readFileSync(path.join(dir, id + ".json"), "utf8")));
  } catch (e) { console.error("game registry:", e.message); return []; }
}

/** Packaged files, keyed by lower-case file name: game sets and BIOS zips found in ROMS_DIR. */
function packagedFiles() {
  if (process.env.PACKAGED_ROM !== "1") return {};
  let onDisk;
  try { onDisk = fs.readdirSync(ROMS_DIR); } catch (_) { return {}; }
  const wanted = new Map();
  for (const g of games()) {
    wanted.set(g.rom.file.toLowerCase(), { kind: "rom", id: g.id });
    if (g.bios) wanted.set(g.bios.file.toLowerCase(), { kind: "bios", id: g.bios.id });
  }
  const out = {};
  for (const n of onDisk) {
    const w = wanted.get(n.toLowerCase());
    if (!w) continue;
    try {
      const file = path.join(ROMS_DIR, n);
      const st = fs.statSync(file);
      if (!st.isFile()) continue;
      // A version segment in the PATH (not a query string: EmulatorJS keeps the
      // query in the file name it hands FBNeo) makes browsers and EmulatorJS's own
      // cache refetch a replaced file. Any /roms/<anything>/<name> serves it.
      out[n.toLowerCase()] = { ...w, name: n.toLowerCase(), file, size: st.size, mtime: st.mtime,
        etag: `"${st.size}-${Math.floor(st.mtimeMs)}"`, url: `roms/v${Math.floor(st.mtimeMs)}/${n}` };
    } catch (_) {}
  }
  return out;
}

/** Stream a file to the response; errors become a 500 (or a dropped socket once
    headers are out) instead of an unhandled 'error' event, and a client that
    aborts destroys the read stream so no descriptor leaks. */
function sendFile(res, file, headers) {
  const stream = fs.createReadStream(file);
  stream.on("open", () => { res.writeHead(200, headers); stream.pipe(res); });
  stream.on("error", (err) => {
    console.error("send failed:", file, err.message);
    if (!res.headersSent) { res.writeHead(500); res.end("error"); } else res.destroy();
  });
  res.on("close", () => stream.destroy());   // client aborted or finished: release the fd
}

function config() {
  const out = {};
  // { roms: { gameId: {name,url,size} }, bios: { biosId: {name,url,size} } }
  const files = Object.values(packagedFiles());
  if (files.length) {
    out.packaged = { roms: {}, bios: {} };
    for (const f of files) out.packaged[f.kind === "rom" ? "roms" : "bios"][f.id] = { name: f.name, url: f.url, size: f.size };
  }
  if (process.env.NETPLAY_URL) out.netplayUrl = process.env.NETPLAY_URL;
  if (process.env.EJS_DATA_PATH) out.ejsDataPath = process.env.EJS_DATA_PATH;
  else if (fs.existsSync(path.join(ROOT, "ejs", "loader.js"))) out.ejsDataPath = "ejs/";
  const num = (k) => (process.env[k] !== undefined && process.env[k] !== "" && Number.isFinite(Number(process.env[k])) ? Number(process.env[k]) : undefined);
  if (num("STREAM_FPS") !== undefined) out.streamFps = num("STREAM_FPS");
  if (num("STREAM_BITRATE_DIRECT") !== undefined) out.streamBitrateDirect = num("STREAM_BITRATE_DIRECT");
  if (num("STREAM_BITRATE_RELAY") !== undefined) out.streamBitrateRelay = num("STREAM_BITRATE_RELAY");
  if (num("INPUT_DELAY_DEFAULT") !== undefined) out.inputDelayDefault = num("INPUT_DELAY_DEFAULT");
  if (process.env.THREADS === "0") out.threads = false;
  if (num("MAX_SPECTATORS") !== undefined) out.maxSpectators = num("MAX_SPECTATORS");
  if (process.env.PUBLIC_URL) out.publicUrl = process.env.PUBLIC_URL;
  if (process.env.ICE_SERVERS) {
    try { out.iceServers = JSON.parse(process.env.ICE_SERVERS); } catch (e) { console.error("ICE_SERVERS is not valid JSON:", e.message); }
  }
  return out;
}

http.createServer((req, res) => {
  try { handle(req, res); } catch (e) {
    console.error(req.method, req.url, e.message);
    if (!res.headersSent) res.writeHead(500);
    res.end("error");
  }
}).listen(PORT, HOST, () => console.log(`3rd Strike Lobby web on http://${HOST}:${PORT} (config: ${JSON.stringify(config())})`));

function handle(req, res) {
  const url = new URL(req.url, "http://x");
  let p = decodeURIComponent(url.pathname);
  if (p === "/config.json") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(config()));
  }
  if (p === "/healthz") { res.writeHead(200); return res.end("ok"); }
  if (p.startsWith("/roms/")) {
    // Only advertised files are ever served, always by their on-disk path.
    const rom = packagedFiles()[path.basename(p).toLowerCase()];
    if (!rom) { res.writeHead(404); return res.end("not found"); }
    const headers = {
      "content-type": "application/zip", "content-length": rom.size, "etag": rom.etag,
      "last-modified": rom.mtime.toUTCString(), "cache-control": "private, max-age=86400"
    };
    if (req.headers["if-none-match"] === rom.etag) { res.writeHead(304, headers); return res.end(); }
    if (req.method === "HEAD") { res.writeHead(200, headers); return res.end(); }
    return sendFile(res, rom.file, headers);
  }
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // Single page: extension-less paths serve the app (keeps ?match=... links working
      // behind prefixes); anything with a dot in its name, dotfiles included, is a 404.
      if (!path.basename(p).includes(".")) return send(path.join(ROOT, "index.html"));
      res.writeHead(404); return res.end("not found");
    }
    send(file);
  });
  function send(f) {
    const type = TYPES[path.extname(f).toLowerCase()] || "application/octet-stream";
    const headers = { "content-type": type, "cache-control": "no-cache" };
    // Allow Matrix clients (Element etc.) to iframe this page as a widget.
    // Do NOT send X-Frame-Options here; frame-ancestors is deliberately open.
    headers["content-security-policy"] = "frame-ancestors *";
    // Pop-out tabs (?isolate=1) become cross-origin isolated so SharedArrayBuffer,
    // and with it EmulatorJS's threaded core, is available. Only on request: COEP
    // on the widget iframe would buy nothing (the parent client is not isolated).
    // "credentialless" lets the no-cors CDN script and CORS core downloads through
    // without CORP headers (Chromium 110+, Firefox 119+; Safari stays unthreaded).
    if (f.endsWith(".html") && url.searchParams.get("isolate") === "1") {
      headers["cross-origin-opener-policy"] = "same-origin";
      headers["cross-origin-embedder-policy"] = "credentialless";
    }
    sendFile(res, f, headers);
  }
}
