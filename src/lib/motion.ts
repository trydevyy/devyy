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

import { useSyncExternalStore } from "react";
import { useReducedMotion, type Transition } from "motion/react";

function subscribe(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-motion", "style"],
  });
  return () => observer.disconnect();
}
const snapshot = () =>
  `${document.documentElement.dataset.motion}/${document.documentElement.style.getPropertyValue("--enter-duration")}`;
export function useSurfaceMotion() {
  const preference = useSyncExternalStore(
    subscribe,
    snapshot,
    () => "full/140ms",
  );
  const systemReduced = useReducedMotion();
  const instant =
    preference.startsWith("reduced/") ||
    preference.endsWith("/0ms") ||
    systemReduced;
  const transition: Transition = instant
    ? { duration: 0 }
    : {
        type: "spring",
        stiffness: preference.endsWith("/200ms") ? 330 : 440,
        damping: 35,
        mass: 0.85,
      };
  return { transition, instant };
}
