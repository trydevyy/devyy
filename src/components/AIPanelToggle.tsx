import { useEffect, useState } from "react";
import { PanelRight } from "lucide-react";
export default function AIPanelToggle() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const changed = (event: Event) =>
      setOpen((event as CustomEvent<boolean>).detail);
    window.addEventListener("devyy-ai-visibility", changed);
    return () => window.removeEventListener("devyy-ai-visibility", changed);
  }, []);
  return (
    <button
      aria-label="Toggle AI workspace"
      title="Toggle AI workspace"
      aria-pressed={open}
      onClick={() => window.dispatchEvent(new CustomEvent("devyy-ai-toggle"))}
    >
      <PanelRight size={16} />
    </button>
  );
}
