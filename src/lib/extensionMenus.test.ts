import { describe, it, expect } from "vitest";
import {
  extensionMenuItems,
  commandPaletteVisible,
  resourceContext,
} from "./extensionMenus";
import type { InstalledExtension } from "./extensions";
const extension = {
  id: "test.menus",
  enabled: true,
  contributes: {
    commands: [
      {
        command: "one",
        title: "One",
        enablement: "allowed",
        toggled: "checked",
      },
      { command: "two", title: "Two" },
    ],
    submenus: [{ id: "more", label: "More" }],
    menus: {
      "explorer/context": [
        { command: "two", group: "navigation@2" },
        {
          command: "one",
          group: "navigation@1",
          when: "resourceExtname == .rs",
        },
        { submenu: "more", group: "other" },
      ],
      more: [{ command: "two" }, { submenu: "more" }],
      commandPalette: [{ command: "one", when: "visible" }],
    },
  },
} as unknown as InstalledExtension;
describe("contributed menus", () => {
  it("orders groups, evaluates conditions and enablement, and keeps submenus bounded", () => {
    const calls: string[] = [];
    const items = extensionMenuItems(
      [extension],
      "explorer/context",
      { resourceExtname: ".rs", allowed: false, checked: true },
      (command) => calls.push(command),
    );
    expect(items.map((i) => i.label)).toEqual(["One", "Two", "More"]);
    expect(items[0].disabled).toBe(true);
    expect(items[0].checked).toBe(true);
    expect(items[2].separator).toBe(true);
    expect(items[2].children?.map((i) => i.label)).toEqual(["Two"]);
    items[1].action?.();
    expect(calls).toEqual(["two"]);
  });
  it("hides commands only where their when clause applies and ignores disabled extensions", () => {
    expect(commandPaletteVisible(extension, "one", {})).toBe(false);
    expect(commandPaletteVisible(extension, "two", {})).toBe(true);
    expect(
      extensionMenuItems(
        [{ ...extension, enabled: false }],
        "explorer/context",
        {},
        () => {},
      ),
    ).toEqual([]);
  });
  it("derives resource context without evaluating extension JavaScript", () => {
    expect(resourceContext("file:///project/a.rs", "rust")).toMatchObject({
      resourceScheme: "file",
      resourceFilename: "a.rs",
      resourceExtname: ".rs",
      resourceLangId: "rust",
      explorerResourceIsFolder: false,
    });
  });
});
