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
      <header>
        <span>
          <i /> Editor preview
        </span>
        <small>preview.ts</small>
      </header>
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
