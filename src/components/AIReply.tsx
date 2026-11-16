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

import { createContext, useContext } from "react";
import type { ComponentProps } from "react";
import { streamText } from "../lib/aiStreamText";
import { useSurfaceMotion } from "../lib/motion";
const LiveText = createContext(false);

let globalWordBatchCounter = 0;
let lastWordBatchTime = 0;

function nextStreamWordDelay(): number {
  const now = Date.now();
  if (now - lastWordBatchTime > 260) {
    globalWordBatchCounter = 0;
  }
  lastWordBatchTime = now;
  const idx = globalWordBatchCounter++;
  return Math.min(idx * 18, 280);
}

function StreamWord({ children, ...props }: ComponentProps<"span">) {
  const live = useContext(LiveText);
  const [reveal] = useState(live);
  const [delay] = useState(() => (live ? nextStreamWordDelay() : 0));
  return (
    <span
      {...props}
      className={reveal ? "ai-stream-word" : undefined}
      style={reveal && delay > 0 ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </span>
  );
}
const streamPlugins = [streamText];
import Select from "./ui/Select";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import type { AIMessage } from "../lib/ai";
import type { AIAttachment } from "../lib/aiContext";
function CodeBlock({
  code,
  language,
  onReview,
}: {
  code: string;
  language: string;
  onReview?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);
  return (
    <div className="ai-code-block">
      <header>
        <small>{language || "Code"}</small>
        <span>
          {onReview && (
            <button
              onClick={onReview}
              title="Review this code as a full replacement of the attached file"
            >
              Review replacement
            </button>
          )}
          <button
            aria-label="Copy code"
            onClick={() =>
              void navigator.clipboard
                .writeText(code)
                .then(() => {
                  setCopied(true);
                  clearTimeout(timeout.current);
                  timeout.current = setTimeout(() => setCopied(false), 1600);
                })
                .catch(() => toast.error("Could not copy code"))
            }
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </span>
      </header>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
function Reply({
  message,
  streaming = false,
  context,
  files,
  onReview,
}: {
  message: AIMessage;
  streaming?: boolean;
  context?: AIMessage["context"];
  files?: AIAttachment[];
  onReview: (path: string, original: string, modified: string) => void;
}) {
  const { instant } = useSurfaceMotion();
  const hasStreamed = useRef(streaming);
  if (streaming) hasStreamed.current = true;
  const shouldReveal = hasStreamed.current && !instant;
  const [target, setTarget] = useState("");
  const file =
    files?.length === 1 ? files[0] : files?.find((file) => file.id === target);
  const selected = file
    ? { path: file.path ?? file.id, content: file.content }
    : context;
  const components = useMemo<Components>(
    () => ({
      span({ node: _node, ...props }) {
        return <StreamWord {...props} />;
      },
      pre({ children }) {
        return <>{children}</>;
      },
      code({ children, className, node, ...props }) {
        const text = String(children),
          block = !!className?.startsWith("language-") || text.includes("\n");
        if (!block)
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        const code = text.replace(/\n$/, "");
        return (
          <CodeBlock
            code={code}
            language={className?.replace("language-", "") ?? ""}
            onReview={
              selected
                ? () => onReview(selected.path, selected.content, code)
                : undefined
            }
          />
        );
      },
      a({ children, href }) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
    }),
    [selected?.path, selected?.content, onReview],
  );
  return (
    <div className="ai-markdown">
      {files && files.length > 1 && (
        <label className="ai-review-target">
          Review target
          <Select
            aria-label="File for suggested replacement"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">Choose a file</option>
            {files.map((file) => (
              <option key={file.id} value={file.id}>
                {file.path ?? file.title}
              </option>
            ))}
          </Select>
        </label>
      )}
      <LiveText.Provider value={streaming && !instant}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={shouldReveal ? streamPlugins : undefined}
          components={components}
        >
          {message.content}
        </ReactMarkdown>
      </LiveText.Provider>
    </div>
  );
}

export default memo(
  Reply,
  (before, after) =>
    before.message === after.message &&
    before.streaming === after.streaming &&
    before.context === after.context &&
    before.onReview === after.onReview &&
    before.files?.length === after.files?.length &&
    (before.files ?? []).every((file, index) => file === after.files?.[index]),
);
