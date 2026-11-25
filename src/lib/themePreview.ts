import { useEffect, useState } from "react";
import {
  embeddedThemePreview,
  matchesPreviewOrigin,
  previewTargetOrigin,
} from "./previewMode";
import type { StoreSprite, StoreTheme } from "./store";

type PreviewState = {
  theme: StoreTheme;
  selected?: string;
  editable: boolean;
};

function send(message: Record<string, unknown>) {
  window.parent.postMessage(message, previewTargetOrigin);
}

export function useThemePreview() {
  const [preview, setPreview] = useState<PreviewState>();
  useEffect(() => {
    if (!embeddedThemePreview) return;
    function receive(event: MessageEvent) {
      if (
        event.source !== window.parent ||
        !matchesPreviewOrigin(event.origin) ||
        event.data?.type !== "devyy:preview-theme"
      )
        return;
      setPreview(event.data.preview);
    }
    window.addEventListener("message", receive);
    send({ type: "devyy:preview-ready" });
    return () => window.removeEventListener("message", receive);
  }, []);
  return preview;
}

export function selectPreviewSprite(id: string) {
  send({ type: "devyy:preview-select-sprite", id });
}

export function movePreviewSprite(
  id: string,
  position: Pick<StoreSprite, "x" | "y">,
) {
  send({ type: "devyy:preview-move-sprite", id, position });
}
