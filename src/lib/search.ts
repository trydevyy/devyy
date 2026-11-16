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

export function searchScore(query: string, label: string, detail = ""): number {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const name = label.toLowerCase(),
    text = `${label} ${detail}`.toLowerCase();
  let score = 0;
  for (const word of words) {
    const exact = text.indexOf(word);
    if (exact >= 0) {
      score += name === word ? 0 : name.startsWith(word) ? 2 : 10 + exact;
      continue;
    }
    let cursor = 0,
      first = -1,
      last = -1;
    for (const char of word) {
      const i = text.indexOf(char, cursor);
      if (i < 0) return Infinity;
      if (first < 0) first = i;
      last = i;
      cursor = i + 1;
    }
    score += 50 + first + (last - first - word.length);
  }
  return score;
}

export function searchHighlights(query: string, text: string) {
  const lower = text.toLowerCase(),
    positions = new Set<number>();
  for (const word of query.toLowerCase().trim().split(/\s+/).filter(Boolean)) {
    const exact = lower.indexOf(word);
    if (exact >= 0) {
      for (let i = exact; i < exact + word.length; i++) positions.add(i);
    } else {
      const found: number[] = [];
      let cursor = 0;
      for (const char of word) {
        const index = lower.indexOf(char, cursor);
        if (index < 0) {
          found.length = 0;
          break;
        }
        found.push(index);
        cursor = index + 1;
      }
      found.forEach((index) => positions.add(index));
    }
  }
  const parts: { text: string; match: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const match = positions.has(i),
      last = parts.at(-1);
    if (last?.match === match) last.text += text[i];
    else parts.push({ text: text[i], match });
  }
  return parts;
}
