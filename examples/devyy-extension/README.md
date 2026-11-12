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
