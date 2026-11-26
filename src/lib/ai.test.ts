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
import { aiSnapshot, remainingLimits, tokenUsage, usageRecorder } from "./ai";
import { cleanCompletion, completionModel } from "./aiCompletion";
import { isAIExtension } from "./aiExtensions";
describe("AI provider usage", () => {
  it("records cumulative Responses usage once, including cached and reasoning tokens", () => {
    const record = usageRecorder("usage-fixture");
    const event = {
      response: {
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 60 },
          output_tokens_details: { reasoning_tokens: 8 },
        },
      },
    };
    record("usage", event);
    record("usage", event);
    record("usage", {
      input_tokens: 150,
      output_tokens: 30,
      input_tokens_details: { cached_tokens: 70 },
      output_tokens_details: { reasoning_tokens: 10 },
    });
    record("cost", { amount: 0.01 });
    record("cost", { amount: 0.01 });
    record("cost", { amount: 0.02 });
    record("request");
    record("request");
    expect(aiSnapshot().usage["usage-fixture"]).toMatchObject({
      inputTokens: 150,
      outputTokens: 30,
      tokens: 180,
      cachedInputTokens: 70,
      reasoningTokens: 10,
      requests: 1,
      costUSD: 0.02,
    });
    const next = usageRecorder("usage-fixture");
    next("usage", { input_tokens: 10, output_tokens: 1 });
    next("request");
    expect(aiSnapshot().usage["usage-fixture"]).toMatchObject({
      tokens: 191,
      requests: 2,
    });
    expect(
      tokenUsage({
        usage: null,
        response: { usage: { input_tokens: 8, output_tokens: 3 } },
      }),
    ).toEqual({ input: 8, output: 3 });
  });
  it("chooses completion models from the actual catalog and removes prose wrappers", () => {
    expect(
      completionModel(
        [{ id: "provider-default", isDefault: true }, { id: "small-mini" }],
        "",
      ),
    ).toBe("small-mini");
    expect(completionModel([{ id: "small-mini" }], "my-model")).toBe(
      "my-model",
    );
    expect(completionModel([], "")).toBe("");
    expect(cleanCompletion('```rust\nprintln!("hello");\n```')).toBe(
      'println!("hello");',
    );
    expect(cleanCompletion("Here is your completion:")).toBe("");
  });
  it("normalizes provider token counters without estimating unavailable values", () => {
    expect(tokenUsage({ prompt_tokens: 120, completion_tokens: 40 })).toEqual({
      input: 120,
      output: 40,
    });
    expect(tokenUsage({ input_tokens: 90, output_tokens: 12 })).toEqual({
      input: 90,
      output: 12,
    });
    expect(tokenUsage({ inputTokens: 5, outputTokens: 8 })).toEqual({
      input: 5,
      output: 8,
    });
    expect(tokenUsage({ input_tokens: -1, output_tokens: "unknown" })).toEqual({
      input: 0,
      output: 0,
    });
  });
  it("uses reported remaining windows and does not interpret request headers as an account balance", () => {
    expect(
      remainingLimits({
        rateLimits: {
          primary: {
            usedPercent: 25,
            resetsAt: 1800000000,
            windowDurationMins: 300,
          },
          secondary: { usedPercent: 110, windowDurationMins: 10080 },
        },
      }),
    ).toEqual([
      { label: "5-hour window", remaining: 75, resetsAt: 1800000000 },
      { label: "Weekly", remaining: 0, resetsAt: undefined },
    ]);
    expect(remainingLimits({ "x-ratelimit-remaining-tokens": "5000" })).toEqual(
      [],
    );
    expect(remainingLimits()).toEqual([]);
  });
  it("reads OpenAI-compatible and Anthropic request limits and Claude Code utilization", () => {
    expect(
      remainingLimits({
        "x-ratelimit-limit-tokens": "1000",
        "x-ratelimit-remaining-tokens": "500",
        "anthropic-ratelimit-requests-limit": "40",
        "anthropic-ratelimit-requests-remaining": "10",
        "anthropic-ratelimit-requests-reset": "2027-01-15T00:00:00Z",
      }),
    ).toEqual([
      { label: "Token rate limit", remaining: 50, total: 1000, available: 500 },
      {
        label: "Request rate limit",
        remaining: 25,
        total: 40,
        available: 10,
        resetsAt: Date.parse("2027-01-15T00:00:00Z") / 1000,
      },
    ]);
    expect(
      remainingLimits({ rateLimitType: "five_hour", utilization: 0.5 }),
    ).toEqual([
      { label: "5-hour allowance", remaining: 50, resetsAt: undefined },
    ]);
  });
  it("anchors relative reset times to the request and retains separate allowance windows", () => {
    const observedAt = 1800000000000;
    expect(
      remainingLimits(
        {
          "x-ratelimit-limit-tokens": "100",
          "x-ratelimit-remaining-tokens": "2",
          "x-ratelimit-reset-tokens": "1m30.5s",
        },
        observedAt,
      )[0],
    ).toMatchObject({ remaining: 2, resetsAt: 1800000090.5 });
    const record = usageRecorder("claude-limit-fixture");
    record("limits", { rateLimitType: "five_hour", utilization: 0.8 });
    record("limits", { rateLimitType: "seven_day", utilization: 0.5 });
    expect(
      remainingLimits(aiSnapshot().usage["claude-limit-fixture"].limits).map(
        ({ label }) => label,
      ),
    ).toEqual(["5-hour allowance", "Weekly allowance"]);
  });
  it("does not treat estimates as provider-reported spend or assume a currency", () => {
    const record = usageRecorder("pricing-fixture");
    record("cost", { amount: 0.02, currency: "USD", estimated: true });
    record("cost", { amount: 0.02, currency: "USD", estimated: true });
    record("cost", { amount: 12, currency: "EUR" });
    record("cost", { amount: 0.01, currency: "USD" });
    expect(aiSnapshot().usage["pricing-fixture"]).toMatchObject({
      costUSD: 0.01,
      estimatedCostUSD: 0.02,
    });
  });
  it("routes the actual AI publishers while leaving unrelated extension panels alone", () => {
    expect(isAIExtension("OpenAI.ChatGPT")).toBe(true);
    expect(isAIExtension("anthropic.claude-code")).toBe(true);
    expect(isAIExtension("fixture.chatgpt")).toBe(false);
  });
  it("includes Antigravity and OpenCode in the default provider list", () => {
    const providerIds = aiSnapshot().providers.map((p) => p.id);
    expect(providerIds).toContain("antigravity");
    expect(providerIds).toContain("opencode");
    const antigravity = aiSnapshot().providers.find(
      (p) => p.id === "antigravity",
    );
    expect(antigravity?.kind).toBe("antigravity");
    const opencode = aiSnapshot().providers.find((p) => p.id === "opencode");
    expect(opencode?.kind).toBe("opencode");
  });
});
