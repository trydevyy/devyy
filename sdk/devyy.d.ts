/** API supported by Devyy's Node extension host. Use require("devyy") at runtime. */
declare module "devyy" {
  export interface Disposable {
    dispose(): void;
  }
  export type Node =
    | { type: "text" | "heading" | "badge"; text: string }
    | { type: "button"; text: string; command: string; args?: unknown[] }
    | {
        type: "input";
        text?: string;
        placeholder?: string;
        command: string;
        args?: unknown[];
      }
    | { type: "stack"; children: Node[] };
  export const ui: {
    /** Registers native React controls. Extension HTML never enters the editor DOM. */
    registerView(
      id: string,
      definition: { title: string; body: Node[] },
    ): Disposable;
    updateView(id: string, body: Node[]): void;
  };
  export const languages: {
    /** Register a stdio LSP executable without a VS Code language client. */
    registerServer(
      languages: (string | { language: string })[],
      options: {
        command: string;
        args?: string[];
        initializationOptions?: unknown;
        settings?: unknown;
      },
    ): Disposable;
  };
}
