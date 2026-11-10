// Rank exact names first, then token and subsequence matches (e.g. smrs → src/main.rs).
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
