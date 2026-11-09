/* Structured server logging: one JSON object per line on stdout (info) or
   stderr (warn/error), e.g. {"t":"2026-11-08T20:01:02.000Z","level":"info","event":"rom_served",...}.
   LOG_FORMAT=text prints "level event key=value ..." instead. */
"use strict";
const text = process.env.LOG_FORMAT === "text";

function write(level, event, fields) {
  const rec = { t: new Date().toISOString(), level, event, ...(fields || {}) };
  const line = text
    ? `${level} ${event}` + Object.entries(fields || {}).map(([k, v]) => ` ${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join("")
    : JSON.stringify(rec);
  (level === "info" ? process.stdout : process.stderr).write(line + "\n");
}

module.exports = {
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields),
  error: (event, fields) => write("error", event, fields)
};
