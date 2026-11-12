// A tiny demonstration server for .devyy-sample files, not a production LSP.
let buffer = Buffer.alloc(0);
function respond(id, result) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const length = Number(
      /content-length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1],
    );
    if (!length || length > 16_000_000) return process.exit(1);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length));
    buffer = buffer.subarray(end + 4 + length);
    if (message.method === "exit") return process.exit(0);
    if (message.id === undefined) continue;
    if (message.method === "initialize")
      respond(message.id, {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: {},
          hoverProvider: true,
        },
        serverInfo: { name: "Devyy sample server", version: "0.1.0" },
      });
    else if (message.method === "textDocument/completion")
      respond(message.id, [
        {
          label: "hello",
          insertText: "hello from Devyy",
          detail: "Bundled extension server",
        },
      ]);
    else if (message.method === "textDocument/hover")
      respond(message.id, {
        contents: {
          kind: "plaintext",
          value: "Connected to the bundled sample language server.",
        },
      });
    else respond(message.id, null);
  }
});
