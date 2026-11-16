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

export type SplitGroup<T> = readonly [T, T];

export function pairTabs<T>(
  groups: readonly SplitGroup<T>[],
  first: T,
  second: T,
): SplitGroup<T>[] {
  if (first === second) return [...groups];
  return [
    ...groups.filter(
      (group) => !group.includes(first) && !group.includes(second),
    ),
    [first, second],
  ];
}

export function separateTab<T>(groups: readonly SplitGroup<T>[], key: T) {
  return groups.filter((group) => !group.includes(key));
}

export function groupedTabs<T, K>(
  tabs: readonly T[],
  keyOf: (tab: T) => K,
  groups: readonly SplitGroup<K>[],
): T[][] {
  const byKey = new Map(tabs.map((tab) => [keyOf(tab), tab]));
  const pairs = groups.filter(([a, b]) => byKey.has(a) && byKey.has(b));
  const secondary = new Set(pairs.map((pair) => pair[1]));
  return tabs.flatMap((tab) => {
    const key = keyOf(tab);
    if (secondary.has(key)) return [];
    const pair = pairs.find((group) => group[0] === key);
    return [pair ? pair.map((member) => byKey.get(member)!) : [tab]];
  });
}

export function moveTabGroup<T, K>(
  tabs: readonly T[],
  keyOf: (tab: T) => K,
  groups: readonly SplitGroup<K>[],
  from: K,
  to: K,
): T[] {
  const order = groupedTabs(tabs, keyOf, groups);
  const source = order.findIndex((group) =>
    group.some((tab) => keyOf(tab) === from),
  );
  const target = order.find((group) => group.some((tab) => keyOf(tab) === to));
  if (source < 0 || !target || order[source] === target) return [...tabs];
  const [moved] = order.splice(source, 1);
  order.splice(order.indexOf(target), 0, moved);
  return order.flat();
}
