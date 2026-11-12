import { memo, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
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
  context,
  files,
  onReview,
}: {
  message: AIMessage;
  context?: AIMessage["context"];
  files?: AIAttachment[];
  onReview: (path: string, original: string, modified: string) => void;
}) {
  const [target, setTarget] = useState("");
  const file =
    files?.length === 1 ? files[0] : files?.find((file) => file.id === target);
  const selected = file
    ? { path: file.path ?? file.id, content: file.content }
    : context;
  return (
    <div className="ai-markdown">
      {files && files.length > 1 && (
        <label className="ai-review-target">
          Review target
          <select
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
          </select>
        </label>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            return <>{children}</>;
          },
          code({ children, className, node, ...props }) {
            const text = String(children),
              block =
                !!className?.startsWith("language-") || text.includes("\n");
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
        }}
      >
        {message.content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(
  Reply,
  (before, after) =>
    before.message === after.message &&
    before.context === after.context &&
    before.onReview === after.onReview &&
    before.files?.length === after.files?.length &&
    (before.files ?? []).every((file, index) => file === after.files?.[index]),
);
