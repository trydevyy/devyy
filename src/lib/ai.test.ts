import { describe, expect, it } from "vitest";
import { remainingLimits, tokenUsage } from "./ai";
import { isAIExtension } from "./aiExtensions";
describe("AI provider usage", () => {
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
          primary: { usedPercent: 25, resetsAt: 1800000000 },
          secondary: { usedPercent: 110 },
        },
      }),
    ).toEqual([
      { label: "Current window", remaining: 75, resetsAt: 1800000000 },
      { label: "Weekly window", remaining: 0, resetsAt: undefined },
    ]);
    expect(remainingLimits({ "x-ratelimit-remaining-tokens": "5000" })).toEqual(
      [],
    );
    expect(remainingLimits()).toEqual([]);
  });
  it("routes the actual AI publishers while leaving unrelated extension panels alone", () => {
    expect(isAIExtension("OpenAI.ChatGPT")).toBe(true);
    expect(isAIExtension("anthropic.claude-code")).toBe(true);
    expect(isAIExtension("fixture.chatgpt")).toBe(false);
  });
});
