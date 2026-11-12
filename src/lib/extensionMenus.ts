import type { MenuItem } from "../components/ContextMenu";
import type { InstalledExtension } from "./extensions";
import { matchesContext } from "./extensionContext";
export interface MenuContribution {
  command?: string;
  alt?: string;
  submenu?: string;
  when?: string;
  group?: string;
}
interface CommandContribution {
  command: string;
  title: string;
  enablement?: string;
  toggled?: string | { condition: string };
}
export function extensionMenuItems(
  extensions: InstalledExtension[],
  location: string,
  context: Record<string, unknown>,
  run: (command: string) => void,
): MenuItem[] {
  const commands = new Map(
    extensions
      .filter((e) => e.enabled)
      .flatMap((e) =>
        (e.contributes.commands ?? []).map(
          (c) => [c.command, c as CommandContribution] as const,
        ),
      ),
  );
  const submenus = new Map(
    extensions
      .filter((e) => e.enabled)
      .flatMap((e) =>
        ((e.contributes.submenus ?? []) as { id: string; label: string }[]).map(
          (s) => [s.id, s.label] as const,
        ),
      ),
  );
  function build(menu: string, visited = new Set<string>()): MenuItem[] {
    if (visited.has(menu) || visited.size > 12) return [];
    const next = new Set(visited).add(menu);
    const entries = extensions
      .filter((e) => e.enabled)
      .flatMap(
        (e) =>
          (
            e.contributes.menus as
              Record<string, MenuContribution[]> | undefined
          )?.[menu] ?? [],
      )
      .filter((item) => matchesContext(item.when, context));
    const group = (item: MenuContribution) => (item.group ?? "").split("@")[0];
    const rank = (item: MenuContribution) =>
      Number((item.group ?? "").split("@")[1]) || 0;
    entries.sort(
      (a, b) =>
        (group(a) === group(b)
          ? 0
          : group(a) === "navigation"
            ? -1
            : group(b) === "navigation"
              ? 1
              : group(a).localeCompare(group(b))) || rank(a) - rank(b),
    );
    let previous: string | undefined;
    return entries.flatMap((item) => {
      const definition = commands.get(item.command ?? "");
      const children = item.submenu ? build(item.submenu, next) : undefined;
      if (item.submenu ? !children?.length : !definition) return [];
      const current = group(item),
        separator = previous !== undefined && previous !== current;
      previous = current;
      const toggled =
        typeof definition?.toggled === "string"
          ? definition.toggled
          : definition?.toggled?.condition;
      return [
        {
          label: item.submenu
            ? (submenus.get(item.submenu) ?? item.submenu)
            : definition!.title,
          separator,
          disabled: !matchesContext(definition?.enablement, context),
          checked: toggled ? matchesContext(toggled, context) : undefined,
          children,
          action: item.command ? () => run(item.command!) : undefined,
        },
      ];
    });
  }
  return build(location);
}
export function commandPaletteVisible(
  extension: InstalledExtension,
  command: string,
  context: Record<string, unknown>,
) {
  const entries = (
    extension.contributes.menus as
      Record<string, MenuContribution[]> | undefined
  )?.commandPalette?.filter((m) => m.command === command);
  return (
    !entries?.length || entries.some((m) => matchesContext(m.when, context))
  );
}
export function resourceContext(
  uri: string,
  language: string,
  folder = false,
): Record<string, unknown> {
  try {
    const u = new URL(uri),
      path = decodeURIComponent(u.pathname),
      name = path.split("/").at(-1) ?? "";
    return {
      resource: uri,
      resourceScheme: u.protocol.slice(0, -1),
      resourceFilename: name,
      resourceExtname: name.includes(".") ? "." + name.split(".").at(-1) : "",
      resourceDirname: path.slice(0, path.lastIndexOf("/")),
      resourcePath: path,
      resourceLangId: language,
      editorLangId: language,
      explorerResourceIsFolder: folder,
    };
  } catch {
    return {};
  }
}
export function commandUri(uri: string) {
  const u = new URL(uri);
  return {
    $mid: 1,
    scheme: u.protocol.slice(0, -1),
    authority: u.host,
    path: decodeURIComponent(u.pathname),
    query: u.search.slice(1),
    fragment: u.hash.slice(1),
    external: uri,
  };
}
