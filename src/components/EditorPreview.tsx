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

import Editor from "./Editor";
import type { Settings } from "../lib/types";
const source =
  'function greet(name: string) {\n    // Format a greeting for the workspace.\n    const message = `Hello, ${name}`;\n    return { message, ready: true };\n}\n\ngreet("devyy");';
const noop = () => {},
  empty: number[] = [],
  diagnostics: [] = [];
export default function EditorPreview({ settings }: { settings: Settings }) {
  return (
    <section className="editor-preview" aria-label="Editor preview">
      <div className="editor-preview-body">
        <Editor
          path="preview.ts"
          value={source}
          settings={settings}
          readOnly
          diagnostics={diagnostics}
          breakpoints={empty}
          onChange={noop}
          onCursor={noop}
          onView={noop}
          onDefinition={noop}
          onBreakpoint={noop}
        />
      </div>
    </section>
  );
}
