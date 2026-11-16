#!/usr/bin/env python3
"""Build the single-step Finder drag-to-Applications disk image."""
import argparse
import json
import platform
import subprocess
import tempfile
from pathlib import Path
import dmgbuild
parser = argparse.ArgumentParser()
parser.add_argument('--app', type=Path)
parser.add_argument('--output', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
app = (args.app or root/'src-tauri/target/release/bundle/macos/Devyy.app').resolve()
version = json.loads((root/'package.json').read_text())['version']
output = args.output or root/f'src-tauri/target/release/bundle/dmg/Devyy-{version}-macos-{platform.machine()}.dmg'
if not app.is_dir():
    raise SystemExit('Build the Devyy editor app first.')
output.parent.mkdir(parents=True, exist_ok=True)
background = root/'installer/assets/dmg-background.png'
if not background.is_file():
    raise SystemExit('Render the Finder background before packaging.')
with tempfile.TemporaryDirectory(prefix='devyy-dmg-') as temporary:
    editor = Path(temporary)/'Devyy.app'
    subprocess.run(['/usr/bin/ditto', '--rsrc', '--extattr', '--acl', str(app), str(editor)], check=True)
    dmgbuild.build_dmg(str(output), 'Devyy', settings={
        'files': [str(editor)], 'symlinks': {'Applications': '/Applications'},
        'icon': str(root/'src-tauri/icons/icon.icns'), 'background': str(background),
        'window_rect': ((120, 100), (640, 400)),
        'icon_locations': {editor.name: (170, 235), 'Applications': (470, 235)},
        'icon_size': 88, 'text_size': 12, 'default_view': 'icon-view',
        'show_toolbar': False, 'show_status_bar': False, 'show_tab_view': False,
        'show_pathbar': False, 'show_sidebar': False,
        'include_icon_view_settings': True, 'format': 'UDZO',
    })
print(output)
