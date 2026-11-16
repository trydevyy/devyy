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

import { describe, expect, it } from "vitest";
import { reasoningOptions, supportedEffort } from "./aiReasoning";
describe("model reasoning capabilities", () => {
  it("keeps each model's names and stages, and clears unsupported saved values", () => {
    const adaptive = {
      id: "adaptive",
      name: "Adaptive",
      reasoningLabel: "Thinking",
      reasoningOptions: [
        { id: "adaptive", label: "Automatic" },
        { id: "budget_8k", label: "Extended thinking" },
      ],
    };
    expect(reasoningOptions(adaptive).map((o) => o.label)).toEqual([
      "Automatic",
      "Extended thinking",
    ]);
    expect(supportedEffort(adaptive, "high")).toBe("");
    expect(supportedEffort(adaptive, "budget_8k")).toBe("budget_8k");
    expect(reasoningOptions({ id: "simple", name: "Simple" })).toEqual([]);
    expect(supportedEffort(undefined, "high")).toBe("");
    expect(
      reasoningOptions({
        id: "legacy",
        name: "Legacy",
        reasoningEfforts: ["low", "xhigh"],
      }).map((o) => o.label),
    ).toEqual(["Low", "Extra high"]);
  });
});
