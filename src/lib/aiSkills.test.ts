import { describe, expect, it } from "vitest";
import { parseSkillMd } from "./aiSkills";

describe("SKILL.md import", () => {
  it("reads folded descriptions, nested metadata, and declared tools", () => {
    const skill = parseSkillMd(`---
name: repository-checks
description: >
  Runs repository
  checks.
allowed-tools: Read Grep
permissions:
  - Read
dependencies:
  - git
metadata:
  version: "2.1.0"
  author: Devyy
---
Check the current diff.
`);
    expect(skill).toMatchObject({
      id: "repository-checks",
      description: "Runs repository checks.",
      version: "2.1.0",
      author: "Devyy",
      permissions: ["Read", "Grep"],
      dependencies: ["git"],
      content: "Check the current diff.",
      toggle: "off",
    });
  });

  it("requires a skill name, description, and instructions", () => {
    expect(() =>
      parseSkillMd("---\nname: Broken Skill\n---\nRun checks."),
    ).toThrow();
    expect(() =>
      parseSkillMd("---\nname: clean-skill\n---\nRun checks."),
    ).toThrow();
  });
});
