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

export type QuickInputIcon =
  string | { id?: string; light?: QuickInputIcon; dark?: QuickInputIcon };
export interface QuickInputButton {
  tooltip?: string;
  icon?: string;
  iconPath?: QuickInputIcon;
  back?: boolean;
}
export interface QuickInputItem {
  index: number;
  label: string;
  description?: string;
  detail?: string;
  kind?: number;
  alwaysShow?: boolean;
  iconPath?: QuickInputIcon;
  buttons?: QuickInputButton[];
}
export interface QuickInputState {
  id: string;
  session: number;
  extension: string;
  kind: "pick" | "input";
  title?: string;
  step?: number;
  totalSteps?: number;
  enabled: boolean;
  busy: boolean;
  ignoreFocusOut: boolean;
  value: string;
  valueVersion: number;
  selectionVersion: number;
  itemsVersion: number;
  buttonsVersion: number;
  placeholder?: string;
  buttons: QuickInputButton[];
  valueSelection?: [number, number];
  password?: boolean;
  prompt?: string;
  validationMessage?: string | { message: string; severity: number };
  items: QuickInputItem[];
  activeItems: number[];
  selectedItems: number[];
  canSelectMany?: boolean;
  matchOnDescription?: boolean;
  matchOnDetail?: boolean;
  keepScrollPosition?: boolean;
  sortByLabel?: boolean;
}
export const quickInputText = (text: string) =>
  text.replace(/\$\([\w~-]+\)/g, "").trim();
function matches(text: string, query: string) {
  const target = quickInputText(text).toLocaleLowerCase();
  let from = 0;
  for (const letter of query) {
    if (/\s/.test(letter)) continue;
    const found = target.indexOf(letter, from);
    if (found < 0) return false;
    from = found + 1;
  }
  return true;
}
export function quickInputItems(state: QuickInputState, value: string) {
  const query = value.trim().toLocaleLowerCase();
  const result: QuickInputItem[] = [];
  let separator: QuickInputItem | undefined;
  for (const item of state.items) {
    if (item.kind === -1) {
      separator = item;
      continue;
    }
    if (
      query &&
      !item.alwaysShow &&
      !matches(item.label, query) &&
      !(state.matchOnDescription && matches(item.description ?? "", query)) &&
      !(state.matchOnDetail && matches(item.detail ?? "", query))
    )
      continue;
    if (separator) {
      result.push(separator);
      separator = undefined;
    }
    result.push(item);
  }
  if (query && state.sortByLabel !== false) {
    let start = 0;
    for (let i = 0; i <= result.length; i++) {
      if (i !== result.length && result[i].kind !== -1) continue;
      const sorted = result
        .slice(start, i)
        .sort((a, b) =>
          quickInputText(a.label).localeCompare(quickInputText(b.label)),
        );
      result.splice(start, sorted.length, ...sorted);
      start = i + 1;
    }
  }
  return result;
}
