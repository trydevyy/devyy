# Devyy extension example

A runnable extension with no npm dependencies. It contributes a VS Code tree,
command, sandboxed webview, native Devyy controls, and a bundled demonstration LSP
server for `.devyy-sample` files. Node.js 20+ must be available to the desktop app.

To install, create a VSIX with the files under `extension/` at the archive root:

```sh
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile
root = Path('examples/devyy-extension')
with ZipFile('/tmp/devyy-example.vsix', 'w') as package:
    for file in root.iterdir():
        if file.is_file():
            package.write(file, 'extension/' + file.name)
PY
```

Use **Settings → Extensions → Install VSIX** to install that file. The activity
rail gains **Extension example**; the command palette gains **Devyy example: Open
example panel**. Native controls appear under **Extensions & languages**. Open a
`.devyy-sample` file inside a project and request completion to exercise the
bundled server. No manual language-server settings are needed.

`require('vscode')` provides Devyy's supported compatibility API.
`require('devyy')` provides native controls and direct server registration.
See `sdk/devyy.d.ts` and the main README for the API boundary and limits.

## Workbench sprites

Use `devyy.ui.createSprite` to show a PNG, JPEG, GIF or WebP from your extension.
Positions refer to the center of the image. Values are percentages of the
workbench by default. Set `unit: "px"` to use pixels instead.

```js
const { ui } = require("devyy");

exports.activate = (context) => {
  const sprite = ui.createSprite({
    image: "assets/mascot.gif",
    x: 92,
    y: 88,
    width: 12,
    opacity: 0.8,
  });
  sprite.update({ y: 80 });
  context.subscriptions.push(sprite);
};
```

The handle supports `show()`, `hide()`, `update(options)`, and `dispose()`.
For a horizontal sprite sheet, set `animation: { frames: 8, fps: 12, aspectRatio: 1 }`.
Images never intercept mouse or keyboard input. GIF and WebP animations are hidden
when reduced motion is enabled. Sprite sheets display their first frame.
