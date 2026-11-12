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
/** One motion language for floating surfaces and navigation; follows both motion preferences. */
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
