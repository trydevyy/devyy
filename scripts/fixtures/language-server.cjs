/* Deterministic protocol fixture. Does not access a network provider or account. */
const net = require("node:net");
let emit,
  initialization,
  opened = false;
function onMessage(message) {
  if (message.method === "initialize") {
    initialization = message;
    emit({
      jsonrpc: "2.0",
      id: "fixture-server-request",
      method: "fixture/authorize",
      params: { value: 42 },
    });
  } else if (message.id === "fixture-server-request")
    emit({
      jsonrpc: "2.0",
      id: initialization.id,
      result: {
        capabilities: { completionProvider: {}, hoverProvider: true },
        serverInfo: { name: "Devyy fixture", version: "1" },
        fixtureReply: message.result,
      },
    });
  else if (message.method === "textDocument/didOpen") {
    opened = true;
    emit({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: message.params.textDocument.uri,
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            severity: 1,
            message: "Fixture diagnostic",
          },
        ],
      },
    });
  } else if (message.id !== undefined)
    emit({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        pid: process.pid,
        env: process.env.DEVYY_LSP_FIXTURE,
        cwd: process.cwd(),
        opened,
        params: message.params,
      },
    });
}
if (process.argv.includes("--node-ipc")) {
  emit = (m) => process.send(m);
  process.on("message", onMessage);
} else {
  const socketArg = process.argv.find((a) => a.startsWith("--socket=")),
    pipeArg = process.argv.find((a) => a.startsWith("--pipe="));
  const input = socketArg
    ? net.connect({ host: "127.0.0.1", port: +socketArg.slice(9) })
    : pipeArg
      ? net.connect(pipeArg.slice(7))
      : process.stdin;
  const output = input === process.stdin ? process.stdout : input;
  emit = (m) => {
    const body = Buffer.from(JSON.stringify(m));
    output.write(
      Buffer.concat([
        Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
        body,
      ]),
    );
  };
  let buffer = Buffer.alloc(0),
    size;
  input.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (size === undefined) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) break;
        size = +buffer
          .subarray(0, end)
          .toString()
          .match(/Content-Length:\s*(\d+)/i)[1];
        buffer = buffer.subarray(end + 4);
      }
      if (buffer.length < size) break;
      const m = JSON.parse(buffer.subarray(0, size));
      buffer = buffer.subarray(size);
      size = undefined;
      onMessage(m);
    }
  });
  input.on("end", () => process.exit());
}
