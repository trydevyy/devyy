import manifest from "../lib/generated/file-icons.json";
import { language } from "../lib/types";
export type IconTheme = {
  file?: string;
  folder?: string;
  folderExpanded?: string;
  fileNames?: Record<string, string>;
  fileExtensions?: Record<string, string>;
  languageIds?: Record<string, string>;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
};
export function fileIconId(
  path: string,
  theme: IconTheme,
  directory = false,
  expanded = false,
) {
  const name = path.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase() ?? "";
  if (directory)
    return (
      (expanded ? theme.folderNamesExpanded : theme.folderNames)?.[name] ??
      (expanded ? theme.folderExpanded : theme.folder) ??
      "folder"
    );
  if (theme.fileNames?.[name]) return theme.fileNames[name];
  const parts = name.split(".");
  for (let i = 1; i < parts.length; i++) {
    const icon = theme.fileExtensions?.[parts.slice(i).join(".")];
    if (icon) return icon;
  }
  return theme.languageIds?.[language(path)] ?? theme.file ?? "file";
}
export default function FileIcon({
  path,
  size = 15,
  directory = false,
  expanded = false,
}: {
  path: string;
  size?: number;
  directory?: boolean;
  expanded?: boolean;
}) {
  const dark = fileIconId(path, manifest as IconTheme, directory, expanded),
    light = fileIconId(
      path,
      { ...manifest, ...manifest.light } as IconTheme,
      directory,
      expanded,
    );
  const icons = manifest.icons as Record<string, string>,
    src = (id: string) => `/file-icons/${icons[id] ?? icons.file}`;
  return (
    <span
      className="file-icon material-file-icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img
        className={light === dark ? "" : "file-icon-dark"}
        src={src(dark)}
        width={size}
        height={size}
        alt=""
        draggable={false}
      />
      {light !== dark && (
        <img
          className="file-icon-light"
          src={src(light)}
          width={size}
          height={size}
          alt=""
          draggable={false}
        />
      )}
    </span>
  );
}
