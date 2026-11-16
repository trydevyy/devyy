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

import { useState } from "react";
import { FileCode2 } from "lucide-react";
const icons: Record<string, string> = {
  vscode: "vscode.png",
  "vscode-insiders": "vscode.png",
  cursor: "cursor.ico",
  windsurf: "windsurf.ico",
  vscodium: "vscodium.svg",
  zed: "zed.png",
};
export default function IDEIcon({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  return icons[id] && !failed ? (
    <img
      className={`ide-import-icon ide-import-icon-${id}`}
      src={`/ide-icons/${icons[id]}`}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={() => setFailed(true)}
    />
  ) : (
    <FileCode2 size={24} aria-hidden="true" />
  );
}
