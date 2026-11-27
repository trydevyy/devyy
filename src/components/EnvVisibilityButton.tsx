import { useLayoutEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { Eye, EyeOff } from "lucide-react";
import { revealEnvValues } from "../lib/envPrivacy";

export default function EnvVisibilityButton({
  getView,
}: {
  getView: () => EditorView | undefined;
}) {
  const [revealed, setRevealed] = useState(false);
  const revealedView = useRef<EditorView | undefined>(undefined);
  useLayoutEffect(
    () => () => {
      if (revealedView.current?.dom.isConnected)
        revealEnvValues(revealedView.current, false);
    },
    [],
  );

  const label = revealed ? "Hide all .env values" : "Reveal all .env values";
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      onClick={() => {
        const view = getView();
        if (!view || !revealEnvValues(view, !revealed)) return;
        revealedView.current = revealed ? undefined : view;
        setRevealed(!revealed);
      }}
    >
      {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  );
}
