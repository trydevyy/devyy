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

export type FilePreviewKind = "image" | "audio" | "video";
export function filePreviewKind(path: string): FilePreviewKind | undefined {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (
    ["png", "jpg", "jpeg", "svg", "webp", "gif", "ico", "bmp", "avif"].includes(
      extension ?? "",
    )
  )
    return "image";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(extension ?? ""))
    return "audio";
  if (["mp4", "webm", "ogv", "mov"].includes(extension ?? "")) return "video";
}
