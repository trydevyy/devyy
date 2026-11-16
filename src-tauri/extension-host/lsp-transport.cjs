// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

"use strict";
const { fork } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const [kind, modulePath, ...args] = process.argv.slice(2);
let child,
  server,
  stream,
  pipePath,
  stopped = false;
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  stream?.destroy();
  server?.close();
  child?.kill();
  if (pipePath && process.platform !== "win32") {
    try {
      require("node:fs").unlinkSync(pipePath);
    } catch {}
  }
  process.exit(code);
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
process.stdin.on("end", () => stop());
process.stdout.on("error", () => stop());
function launch(flag) {
  child = fork(modulePath, [...args, flag], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    execArgv: process.execArgv,
  });
  child.stdout.pipe(process.stderr);
  child.stderr.pipe(process.stderr);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
  return child;
}
if (kind === "1") {
  const processChild = launch("--node-ipc");
  let buffer = Buffer.alloc(0),
    size;
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    try {
      while (true) {
        if (size === undefined) {
          const end = buffer.indexOf("\r\n\r\n");
          if (end < 0) {
            if (buffer.length > 8192) throw Error("Oversized LSP header");
            break;
          }
          const match = /^Content-Length:\s*(\d+)\s*$/im.exec(
            buffer.subarray(0, end).toString("ascii"),
          );
          if (!match || +match[1] > 16_000_000)
            throw Error("Invalid LSP Content-Length");
          size = +match[1];
          buffer = buffer.subarray(end + 4);
        }
        if (buffer.length < size) break;
        const value = JSON.parse(buffer.subarray(0, size).toString("utf8"));
        buffer = buffer.subarray(size);
        size = undefined;
        processChild.send(value, (error) => {
          if (error) stop(1);
        });
      }
    } catch (error) {
      console.error(error.message);
      stop(1);
    }
  });
  processChild.on("message", (message) => {
    const body = Buffer.from(JSON.stringify(message));
    if (body.length > 16_000_000) return stop(1);
    process.stdout.write(
      Buffer.concat([
        Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
        body,
      ]),
    );
  });
} else if (kind === "2" || kind === "3") {
  server = net.createServer((socket) => {
    if (stream) {
      socket.destroy();
      return;
    }
    stream = socket;
    server.close();
    process.stdin.pipe(socket);
    socket.pipe(process.stdout);
    socket.on("error", (error) => {
      console.error(error.message);
      stop(1);
    });
    socket.on("end", () => stop());
  });
  server.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  if (kind === "2") {
    pipePath =
      process.platform === "win32"
        ? "\\\\.\\pipe\\devyy-lsp-" + crypto.randomUUID()
        : path.join(
            os.tmpdir().length > 60 ? "/tmp" : os.tmpdir(),
            "devyy-lsp-" + crypto.randomBytes(6).toString("hex") + ".sock",
          );
    server.listen(pipePath, () => launch("--pipe=" + pipePath));
  } else {
    server.listen(0, "127.0.0.1", () =>
      launch("--socket=" + server.address().port),
    );
  }
} else {
  console.error("Unknown Node language-server transport");
  stop(1);
}
