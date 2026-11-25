#!/usr/bin/env python3
"""Build the single-step Finder drag-to-Applications disk image."""
import argparse
import json
import os
import platform
import plistlib
import subprocess
import tempfile
from pathlib import Path
import dmgbuild
parser = argparse.ArgumentParser()
parser.add_argument('--app', type=Path)
parser.add_argument('--output', type=Path)
parser.add_argument('--local-only', action='store_true')
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
def verify_app(bundle):
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(bundle)], check=True)
    if not args.local_only:
        subprocess.run(['xcrun', 'stapler', 'validate', str(bundle)], check=True)
        subprocess.run(['/usr/sbin/spctl', '--assess', '--type', 'execute', str(bundle)], check=True)

verify_app(app)
with tempfile.TemporaryDirectory(prefix='devyy-dmg-') as temporary:
    editor = Path(temporary)/'Devyy.app'
    subprocess.run(['/usr/bin/ditto', '--rsrc', '--extattr', '--acl', str(app), str(editor)], check=True)
    verify_app(editor)
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
mounted = plistlib.loads(subprocess.check_output(
    ['hdiutil', 'attach', '-plist', '-readonly', '-nobrowse', str(output)]
))
volumes = [Path(entry['mount-point']) for entry in mounted['system-entities']
           if 'mount-point' in entry]
try:
    volume = next((volume for volume in volumes if (volume / 'Devyy.app').is_dir()), None)
    if volume is None:
        raise SystemExit('The mounted disk image does not contain Devyy.app.')
    verify_app(volume / 'Devyy.app')
finally:
    for volume in volumes:
        subprocess.run(['hdiutil', 'detach', str(volume)], check=True)

if not args.local_only:
    details = subprocess.run(
        ['/usr/bin/codesign', '-dv', '--verbose=4', str(app)],
        capture_output=True, text=True, check=True,
    ).stderr
    identity = next((line.removeprefix('Authority=') for line in details.splitlines()
                     if line.startswith('Authority=Developer ID Application: ')), None)
    if not identity:
        raise SystemExit('The app must be signed with a Developer ID Application certificate.')
    subprocess.run(['/usr/bin/codesign', '--force', '--sign', identity, '--timestamp', str(output)], check=True)
    subprocess.run([
        'xcrun', 'notarytool', 'submit', str(output), '--wait',
        '--apple-id', os.environ['APPLE_ID'], '--password', os.environ['APPLE_PASSWORD'],
        '--team-id', os.environ['APPLE_TEAM_ID'],
    ], check=True)
    subprocess.run(['xcrun', 'stapler', 'staple', str(output)], check=True)
    subprocess.run(['xcrun', 'stapler', 'validate', str(output)], check=True)
    subprocess.run(['/usr/sbin/spctl', '--assess', '--type', 'open', '--context',
                    'context:primary-signature', str(output)], check=True)
print(output)
