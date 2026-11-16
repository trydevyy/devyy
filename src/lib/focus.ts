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

export function restoreFocus(target: HTMLElement | null | undefined) {
  if (!target?.isConnected) return;
  if (target instanceof HTMLIFrameElement) {
    target.contentWindow?.focus();
    target.contentWindow?.postMessage({ channel: "devyy-focus" }, "*");
  } else target.focus({ preventScroll: true });
}

export function activeSurface(selector: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (element) =>
      !element.closest('[inert], [data-closing="true"], [data-state="closed"]'),
  );
}
