const vscode = require("vscode");
const devyy = require("devyy");
exports.activate = (context) => {
  context.subscriptions.push(
    vscode.commands.registerCommand("devyy.example.open", () => {
      const panel = vscode.window.createWebviewPanel(
        "devyy.example",
        "Extension example",
        vscode.ViewColumn.Beside,
        { enableScripts: true },
      );
      panel.webview.onDidReceiveMessage((message) => {
        if (message.action === "hello")
          panel.webview.postMessage({ text: "Hello from the extension host." });
      });
      panel.webview.html = `<!doctype html><html><body><h2>Make yourself at home.</h2><p>This webview follows Devyy’s theme. Its scripts run in an isolated frame.</p><button id="hello">Say hello</button><p id="reply"></p><script>const api = acquireVsCodeApi(); document.querySelector('#hello').onclick = () => api.postMessage({ action: 'hello' }); window.addEventListener('message', event => { if (event.data?.text) document.querySelector('#reply').textContent = event.data.text; });</script></body></html>`;
    }),
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("devyy.example.tree", {
      getChildren: (parent) =>
        parent
          ? [
              {
                label: "Open webview",
                command: {
                  command: "devyy.example.open",
                  title: "Open webview",
                },
              },
            ]
          : [
              {
                label: "Example extension",
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
              },
            ],
      getTreeItem: (element) => element,
    }),
  );
  context.subscriptions.push(
    devyy.ui.registerView("devyy.example.native", {
      title: "Native extension controls",
      body: [
        { type: "heading", text: "Built for Devyy" },
        {
          type: "text",
          text: "These controls share the editor’s fonts, spacing, keyboard focus, and colors.",
        },
        {
          type: "button",
          text: "Open example panel",
          command: "devyy.example.open",
        },
        { type: "badge", text: "Native UI" },
      ],
    }),
  );
};
