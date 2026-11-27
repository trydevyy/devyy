import { useEffect, useState } from "react";
import { highlightSnippet } from "../lib/codeHighlight";

export default function HighlightedCode({
  code,
  language,
  path,
  streaming,
}: {
  code: string;
  language?: string;
  path?: string;
  streaming?: boolean;
}) {
  const [highlighted, setHighlighted] = useState<{
    code: string;
    language?: string;
    path?: string;
    parts: Awaited<ReturnType<typeof highlightSnippet>>;
  }>();
  useEffect(() => {
    let active = true;
    const highlight = () => {
      void highlightSnippet(code, { language, path })
        .then((parts) => {
          if (active)
            setHighlighted(
              parts.length ? { code, language, path, parts } : undefined,
            );
        })
        .catch(() => {});
    };
    const timer = streaming ? setTimeout(highlight, 100) : undefined;
    if (!streaming) highlight();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [code, language, path, streaming]);
  const parts =
    highlighted?.code === code &&
    highlighted.language === language &&
    highlighted.path === path
      ? highlighted.parts
      : undefined;
  return (
    <code className="devyy-syntax">
      {parts
        ? parts.map(({ text, classes }, index) =>
            classes ? (
              <span key={index} className={classes}>
                {text}
              </span>
            ) : (
              text
            ),
          )
        : code}
    </code>
  );
}
