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

import { describe, it, expect } from "vitest";
import {
  parseSignatureHelp,
  createSignatureHelpDOM,
  type SignatureHelp,
} from "./lspSignatureHelp";

describe("lspSignatureHelp", () => {
  it("parses signature and active parameter correctly", () => {
    const help: SignatureHelp = {
      signatures: [
        {
          label: "add(a: number, b: number): number",
          documentation: "Adds two numbers.",
          parameters: [
            { label: "a: number", documentation: "First number" },
            { label: "b: number", documentation: "Second number" },
          ],
          activeParameter: 0,
        },
      ],
      activeSignature: 0,
      activeParameter: 0,
    };

    const parsed = parseSignatureHelp(help);
    expect(parsed).not.toBeNull();
    expect(parsed?.label).toBe("add(a: number, b: number): number");
    expect(parsed?.beforeParam).toBe("add(");
    expect(parsed?.activeParam).toBe("a: number");
    expect(parsed?.afterParam).toBe(", b: number): number");
    expect(parsed?.documentation).toBe("First number");
  });

  it("handles numeric tuple parameter ranges", () => {
    const help: SignatureHelp = {
      signatures: [
        {
          label: "fn calculate(x: i32, y: i32) -> i32",
          parameters: [{ label: [13, 19] }, { label: [21, 27] }],
        },
      ],
      activeSignature: 0,
      activeParameter: 1,
    };

    const parsed = parseSignatureHelp(help);
    expect(parsed).not.toBeNull();
    expect(parsed?.beforeParam).toBe("fn calculate(x: i32, ");
    expect(parsed?.activeParam).toBe("y: i32");
    expect(parsed?.afterParam).toBe(") -> i32");
  });

  it("handles multiple signatures with counter", () => {
    const help: SignatureHelp = {
      signatures: [{ label: "print()" }, { label: "print(message: string)" }],
      activeSignature: 1,
    };

    const parsed = parseSignatureHelp(help);
    expect(parsed).not.toBeNull();
    expect(parsed?.counter).toBe("2/2");
    expect(parsed?.label).toBe("print(message: string)");
  });

  it("renders DOM when document environment is provided", () => {
    const fakeDoc = {
      createElement: (tag: string) => {
        const el: any = {
          tagName: tag.toUpperCase(),
          className: "",
          textContent: "",
          children: [] as any[],
          append: (...args: any[]) => {
            for (const a of args) {
              el.children.push(typeof a === "string" ? { textContent: a } : a);
            }
          },
          appendChild: (c: any) => el.children.push(c),
        };
        return el;
      },
      createTextNode: (text: string) => ({ textContent: text }),
    };

    const orig = (globalThis as any).document;
    (globalThis as any).document = fakeDoc;
    try {
      let closed = false;
      const help: SignatureHelp = {
        signatures: [
          { label: "test(a: i32)", parameters: [{ label: "a: i32" }] },
        ],
      };
      const dom = createSignatureHelpDOM(help, () => {
        closed = true;
      });
      expect(dom).not.toBeNull();
      expect(dom.className).toBe("cm-signature-help");
      expect(closed).toBe(false);
    } finally {
      (globalThis as any).document = orig;
    }
  });
});
