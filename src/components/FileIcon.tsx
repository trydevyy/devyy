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
    src = (id: string) =>
      `${import.meta.env.BASE_URL}file-icons/${icons[id] ?? icons.file}`;
  return (
    <span
      className="file-icon material-file-icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img
        className={light === dark ? "" : "file-icon-dark"}
        src={src(dark)}
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        alt=""
        draggable={false}
      />
      {light !== dark && (
        <img
          className="file-icon-light"
          src={src(light)}
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          alt=""
          draggable={false}
        />
      )}
    </span>
  );
}

export function LanguageIcon({ language: id }: { language: string }) {
  const aliases: Record<string, string> = { "c++": "cpp", "c#": "csharp" };
  const languageIds = manifest.languageIds as Record<string, string>;
  const extensions = manifest.fileExtensions as Record<string, string>;
  const icons = manifest.icons as Record<string, string>;
  const languageId = aliases[id] ?? id;
  const name =
    icons[languageIds[languageId] ?? extensions[languageId] ?? languageId] ??
    icons.file;
  return (
    <img
      className="settings-store-icon"
      src={`${import.meta.env.BASE_URL}file-icons/${name}`}
      alt=""
      loading="lazy"
    />
  );
}
