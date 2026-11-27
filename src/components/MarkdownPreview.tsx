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

import { writeClipboardText } from "../lib/clipboard";
import {
  Children,
  isValidElement,
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";
import HighlightedCode from "./HighlightedCode";
import { Copy, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { invoke, native } from "../lib/native";
import { headingId, markdownPath } from "../lib/markdown";
import { openUrl } from "@tauri-apps/plugin-opener";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, string> };
};
function remarkHeadingIds() {
  return (tree: MarkdownNode) => {
    const seen = new Map<string, number>();
    const text = (node: MarkdownNode): string =>
      node.value ?? node.children?.map(text).join("") ?? "";
    const visit = (node: MarkdownNode) => {
      if (node.type === "heading") {
        const base = headingId(text(node));
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        node.data = {
          ...node.data,
          hProperties: { id: count ? `${base}-${count}` : base },
        };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
const markdownPlugins = [remarkGfm, remarkHeadingIds];
const htmlPlugins: PluggableList = [
  rehypeRaw,
  [
    rehypeSanitize,
    {
      ...defaultSchema,
      tagNames: [
        ...(defaultSchema.tagNames ?? []),
        "figure",
        "figcaption",
        "mark",
        "abbr",
      ],
      strip: [
        ...(defaultSchema.strip ?? []),
        "style",
        "iframe",
        "object",
        "embed",
        "form",
      ],
    },
  ],
];
function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textOf(child.props.children)
        : String(child),
    )
    .join("");
}
function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <div className="markdown-code-block">
      <div>
        <span>{language || "Code"}</span>
        <button
          aria-label="Copy code"
          title="Copy code"
          onClick={() =>
            void writeClipboardText(code)
              .then(() => toast.success("Code copied"))
              .catch(() => toast.error("Could not copy code"))
          }
        >
          <Copy size={13} />
        </button>
      </div>
      <pre>
        <HighlightedCode code={code} language={language} />
      </pre>
    </div>
  );
}
function MarkdownImage({
  src,
  alt,
  path,
  root,
  width,
  height,
  title,
}: {
  width?: string | number;
  height?: string | number;
  title?: string;
  src: string;
  alt?: string;
  path: string;
  root: string;
}) {
  const remote = /^https?:\/\//i.test(src);
  const relative = markdownPath(path, src)?.path;
  const [image, setImage] = useState<{ key: string; url: string }>();
  const key = `${root}:${relative}`;
  useEffect(() => {
    if (remote || !relative || !native || root === "demo") return;
    let current = true;
    void invoke<string>("read_preview_image", { path: relative })
      .then((url) => {
        if (current) setImage({ key, url });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [root, relative, remote, key]);
  const url = remote ? src : image?.key === key ? image.url : undefined;
  return url ? (
    <img
      src={url}
      alt={alt ?? ""}
      width={width}
      height={height}
      title={title}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.alt = alt
          ? `${alt} (image unavailable)`
          : "Image unavailable";
      }}
    />
  ) : (
    <span className="markdown-image-missing">
      <ImageOff size={15} />
      {alt || "Image unavailable"}
    </span>
  );
}
function MarkdownPreview({
  path,
  root,
  content,
  onOpen,
}: {
  path: string;
  root: string;
  content: string;
  onOpen: (path: string, line?: number) => void;
}) {
  const source = useDeferredValue(content);
  const components = useMemo(() => {
    return {
      pre: ({ children }: { children?: ReactNode }) => {
        const child = Children.toArray(children)[0];
        if (
          !isValidElement<{ className?: string; children?: ReactNode }>(child)
        )
          return <pre>{children}</pre>;
        return (
          <CodeBlock
            code={textOf(child.props.children).replace(/\n$/, "")}
            language={
              /language-([^ ]+)/.exec(child.props.className ?? "")?.[1] ?? ""
            }
          />
        );
      },
      img: ({
        src,
        alt,
        width,
        height,
        title,
      }: {
        src?: string;
        alt?: string;
        width?: string | number;
        height?: string | number;
        title?: string;
      }) => (
        <MarkdownImage
          src={src ?? ""}
          alt={alt}
          width={width}
          height={height}
          title={title}
          path={path}
          root={root}
        />
      ),
      a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (!href) return;
            if (href.startsWith("#")) {
              try {
                const id = decodeURIComponent(href.slice(1));
                const preview = e.currentTarget.closest(".markdown-preview");
                Array.from(preview?.querySelectorAll("[id]") ?? [])
                  .find((el) => el.id === `user-content-${id}` || el.id === id)
                  ?.scrollIntoView({ block: "start" });
              } catch {}
              return;
            }
            if (/^https?:\/\//i.test(href)) {
              if (native)
                void openUrl(href).catch(() =>
                  toast.error("Could not open link"),
                );
              else window.open(href, "_blank", "noopener,noreferrer");
              return;
            }
            const target = markdownPath(path, href);
            if (target)
              onOpen(
                target.path,
                /^L\d+/.test(target.hash)
                  ? Number(target.hash.slice(1))
                  : undefined,
              );
          }}
        >
          {children}
        </a>
      ),
    };
  }, [path, root, onOpen]);
  return (
    <article
      className="markdown-preview"
      aria-label={`Markdown preview: ${path}`}
    >
      <div className="markdown-prose">
        <ReactMarkdown
          remarkPlugins={markdownPlugins}
          rehypePlugins={htmlPlugins}
          components={components}
        >
          {source}
        </ReactMarkdown>
      </div>
    </article>
  );
}
export default memo(MarkdownPreview);
