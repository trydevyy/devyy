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

import { RangeSet } from "@codemirror/state";
import { Decoration, GutterMarker, WidgetType } from "@codemirror/view";
import { pathFromUri } from "./native";

export interface DecorationPosition {
  line: number;
  character: number;
}

export interface DecorationRange {
  start: DecorationPosition;
  end: DecorationPosition;
}

export interface DecorationAttachment {
  contentText?: string;
  contentIconPath?: string;
  color?: string | { id: string };
  backgroundColor?: string | { id: string };
  fontStyle?: string;
  fontWeight?: string;
  textDecoration?: string;
  margin?: string;
  border?: string;
  borderColor?: string | { id: string };
}

export interface DecorationRenderOptions {
  backgroundColor?: string | { id: string };
  color?: string | { id: string };
  border?: string;
  borderColor?: string | { id: string };
  borderStyle?: string;
  borderWidth?: string;
  borderRadius?: string;
  fontStyle?: string;
  fontWeight?: string;
  textDecoration?: string;
  cursor?: string;
  opacity?: string;
  letterSpacing?: string;
  isWholeLine?: boolean;
  gutterIconPath?: string;
  gutterIconSize?: string;
  overviewRulerColor?: string | { id: string };
  before?: DecorationAttachment;
  after?: DecorationAttachment;
  light?: DecorationRenderOptions;
  dark?: DecorationRenderOptions;
}

export interface DecorationRangeEntry {
  range?: DecorationRange;
  start?: DecorationPosition;
  end?: DecorationPosition;
  hoverMessage?: string | { value: string } | Array<string | { value: string }>;
  renderOptions?: DecorationRenderOptions;
}

export class AttachmentWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly styles: Record<string, string>,
    readonly hover?: string,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-extension-attachment";
    span.textContent = this.text;
    if (this.hover) span.title = this.hover;
    for (const [k, v] of Object.entries(this.styles)) {
      (span.style as unknown as Record<string, string>)[k] = v;
    }
    return span;
  }

  eq(other: AttachmentWidget) {
    return (
      this.text === other.text &&
      this.hover === other.hover &&
      JSON.stringify(this.styles) === JSON.stringify(other.styles)
    );
  }

  ignoreEvent() {
    return false;
  }
}

export class ExtensionGutterMarker extends GutterMarker {
  constructor(
    readonly icon: string,
    readonly size?: string,
  ) {
    super();
  }

  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-extension-gutter-icon";
    img.src = this.icon;
    if (this.size) {
      img.style.width = this.size;
      img.style.height = this.size;
    }
    return img;
  }

  eq(other: ExtensionGutterMarker) {
    return this.icon === other.icon && this.size === other.size;
  }
}

export function resolveColor(
  color?: string | { id: string },
): string | undefined {
  if (!color) return undefined;
  if (typeof color === "string") return color;
  if (typeof color === "object" && color.id) {
    const varName = color.id.replace(/\./g, "-");
    return `var(--vscode-${varName}, var(--accent, #3b82f6))`;
  }
  return undefined;
}

export function buildMarkStyle(opts?: DecorationRenderOptions): string {
  if (!opts) return "";
  const parts: string[] = [];
  const bg = resolveColor(opts.backgroundColor);
  if (bg) parts.push(`background-color: ${bg}`);
  const fg = resolveColor(opts.color);
  if (fg) parts.push(`color: ${fg}`);
  if (opts.border) parts.push(`border: ${opts.border}`);
  const bc = resolveColor(opts.borderColor);
  if (bc) parts.push(`border-color: ${bc}`);
  if (opts.borderStyle) parts.push(`border-style: ${opts.borderStyle}`);
  if (opts.borderWidth) parts.push(`border-width: ${opts.borderWidth}`);
  if (opts.borderRadius) parts.push(`border-radius: ${opts.borderRadius}`);
  if (opts.fontStyle) parts.push(`font-style: ${opts.fontStyle}`);
  if (opts.fontWeight) parts.push(`font-weight: ${opts.fontWeight}`);
  if (opts.textDecoration)
    parts.push(`text-decoration: ${opts.textDecoration}`);
  if (opts.cursor) parts.push(`cursor: ${opts.cursor}`);
  if (opts.opacity) parts.push(`opacity: ${opts.opacity}`);
  if (opts.letterSpacing) parts.push(`letter-spacing: ${opts.letterSpacing}`);
  return parts.join("; ");
}

export function buildAttachmentStyle(
  att?: DecorationAttachment,
): Record<string, string> {
  if (!att) return {};
  const s: Record<string, string> = {};
  const fg = resolveColor(att.color);
  if (fg) s.color = fg;
  const bg = resolveColor(att.backgroundColor);
  if (bg) s.backgroundColor = bg;
  if (att.fontStyle) s.fontStyle = att.fontStyle;
  if (att.fontWeight) s.fontWeight = att.fontWeight;
  if (att.textDecoration) s.textDecoration = att.textDecoration;
  if (att.margin) s.margin = att.margin;
  if (att.border) s.border = att.border;
  const bc = resolveColor(att.borderColor);
  if (bc) s.borderColor = bc;
  return s;
}

export function formatHoverMessage(
  hoverMessage?: string | { value: string } | Array<string | { value: string }>,
): string {
  if (!hoverMessage) return "";
  if (Array.isArray(hoverMessage)) {
    return hoverMessage
      .map((item) => (typeof item === "string" ? item : item.value))
      .filter(Boolean)
      .join("\n\n");
  }
  return typeof hoverMessage === "string" ? hoverMessage : hoverMessage.value;
}

const decorationTypes = new Map<string, DecorationRenderOptions>();
const documentDecorations = new Map<
  string,
  Map<string, DecorationRangeEntry[]>
>();
const listeners = new Set<(path?: string) => void>();

export function registerDecorationType(
  key: string,
  options: DecorationRenderOptions = {},
) {
  decorationTypes.set(key, options);
  notifyListeners();
}

export function removeDecorationType(key: string) {
  decorationTypes.delete(key);
  for (const map of documentDecorations.values()) {
    map.delete(key);
  }
  notifyListeners();
}

export function setDocumentDecorations(
  key: string,
  uri: string,
  ranges: DecorationRangeEntry[],
) {
  let fileMap = documentDecorations.get(uri);
  if (!fileMap) {
    fileMap = new Map();
    documentDecorations.set(uri, fileMap);
  }
  if (!ranges || ranges.length === 0) {
    fileMap.delete(key);
  } else {
    fileMap.set(key, ranges);
  }
  notifyListeners(uri);
}

export function clearExtensionDecorations() {
  decorationTypes.clear();
  documentDecorations.clear();
  notifyListeners();
}

export function onDecorationsChanged(callback: (path?: string) => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners(path?: string) {
  for (const listener of listeners) {
    try {
      listener(path);
    } catch {}
  }
}

export function matchesDocPath(
  docPath: string,
  targetUri: string,
  root?: string,
): boolean {
  if (docPath === targetUri) return true;
  if (root) {
    const rel = pathFromUri(targetUri, root);
    if (rel && rel === docPath) return true;
  }
  const norm1 = docPath.replace(/\\/g, "/").toLowerCase();
  let norm2 = targetUri.replace(/\\/g, "/").toLowerCase();
  if (norm2.startsWith("file://")) {
    try {
      const u = new URL(norm2);
      norm2 = decodeURIComponent(u.pathname).toLowerCase();
      if (/^\/[a-z]:\//i.test(norm2)) norm2 = norm2.slice(1);
    } catch {}
  }
  if (
    norm1 === norm2 ||
    norm2.endsWith("/" + norm1) ||
    norm1.endsWith("/" + norm2)
  ) {
    return true;
  }
  return false;
}

export interface TextDocumentLike {
  lines: number;
  length: number;
  line(n: number): { from: number; to: number; number: number };
}

export function computeExtensionDecorations(
  doc: TextDocumentLike,
  docPath: string,
  root?: string,
): {
  decorations: RangeSet<Decoration>;
  gutterMarkers: RangeSet<GutterMarker>;
} {
  const markDecorations: Array<{
    from: number;
    to: number;
    value: Decoration;
  }> = [];
  const gutterMarkers: Array<{
    from: number;
    to: number;
    value: GutterMarker;
  }> = [];

  for (const [targetUri, fileMap] of documentDecorations.entries()) {
    if (!matchesDocPath(docPath, targetUri, root)) continue;

    for (const [typeKey, entries] of fileMap.entries()) {
      const typeOpts = decorationTypes.get(typeKey) || {};

      for (const entry of entries) {
        const range =
          entry.range ??
          (entry.start && entry.end
            ? { start: entry.start, end: entry.end }
            : null);
        if (!range) continue;

        const startLine = Math.max(
          1,
          Math.min(range.start.line + 1, doc.lines),
        );
        const endLine = Math.max(1, Math.min(range.end.line + 1, doc.lines));
        const lineStart = doc.line(startLine);
        const lineEnd = doc.line(endLine);

        let from = Math.min(
          lineStart.to,
          lineStart.from + Math.max(0, range.start.character),
        );
        let to = Math.min(
          lineEnd.to,
          lineEnd.from + Math.max(0, range.end.character),
        );

        if (from > to) {
          const tmp = from;
          from = to;
          to = tmp;
        }

        const isWholeLine =
          entry.renderOptions?.isWholeLine ?? typeOpts.isWholeLine;
        if (isWholeLine) {
          from = lineStart.from;
          to = lineEnd.to;
        }

        const mergedOpts: DecorationRenderOptions = {
          ...typeOpts,
          ...entry.renderOptions,
        };
        const styleStr = buildMarkStyle(mergedOpts);
        const hoverStr = formatHoverMessage(entry.hoverMessage);

        if (styleStr) {
          markDecorations.push(
            Decoration.mark({
              attributes: { style: styleStr },
            }).range(from, to),
          );
        }

        const beforeAtt = entry.renderOptions?.before ?? typeOpts.before;
        if (beforeAtt?.contentText) {
          markDecorations.push(
            Decoration.widget({
              widget: new AttachmentWidget(
                beforeAtt.contentText,
                buildAttachmentStyle(beforeAtt),
                hoverStr,
              ),
              side: -1,
            }).range(from, from),
          );
        }

        const afterAtt = entry.renderOptions?.after ?? typeOpts.after;
        if (afterAtt?.contentText) {
          markDecorations.push(
            Decoration.widget({
              widget: new AttachmentWidget(
                afterAtt.contentText,
                buildAttachmentStyle(afterAtt),
                hoverStr,
              ),
              side: 1,
            }).range(to, to),
          );
        }

        const gutterIcon =
          entry.renderOptions?.gutterIconPath ?? typeOpts.gutterIconPath;
        if (gutterIcon) {
          gutterMarkers.push(
            new ExtensionGutterMarker(
              gutterIcon,
              typeOpts.gutterIconSize,
            ).range(lineStart.from),
          );
        }
      }
    }
  }

  return {
    decorations: RangeSet.of(markDecorations, true),
    gutterMarkers: RangeSet.of(gutterMarkers, true),
  };
}

export function getExtensionDecorationHover(
  doc: TextDocumentLike,
  docPath: string,
  pos: number,
  root?: string,
): { from: number; to: number; text: string } | null {
  for (const [targetUri, fileMap] of documentDecorations.entries()) {
    if (!matchesDocPath(docPath, targetUri, root)) continue;

    for (const [, entries] of fileMap.entries()) {
      for (const entry of entries) {
        if (!entry.hoverMessage) continue;

        const range =
          entry.range ??
          (entry.start && entry.end
            ? { start: entry.start, end: entry.end }
            : null);
        if (!range) continue;

        const startLine = Math.max(
          1,
          Math.min(range.start.line + 1, doc.lines),
        );
        const endLine = Math.max(1, Math.min(range.end.line + 1, doc.lines));
        const lineStart = doc.line(startLine);
        const lineEnd = doc.line(endLine);

        const from = Math.min(
          lineStart.to,
          lineStart.from + Math.max(0, range.start.character),
        );
        const to = Math.min(
          lineEnd.to,
          lineEnd.from + Math.max(0, range.end.character),
        );

        if (pos >= from && pos <= to) {
          const text = formatHoverMessage(entry.hoverMessage);
          if (text) return { from, to, text };
        }
      }
    }
  }
  return null;
}

if (typeof window !== "undefined") {
  window.addEventListener("devyy-extension-event", (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (!detail) return;
    const { event, payload } = detail;
    if (event === "decorationType" && payload?.key) {
      registerDecorationType(
        payload.key,
        payload.options as DecorationRenderOptions,
      );
    } else if (event === "decorationTypeRemoved" && payload?.key) {
      removeDecorationType(payload.key);
    } else if (event === "decorations" && payload?.key && payload?.uri) {
      setDocumentDecorations(
        payload.key,
        payload.uri,
        (payload.ranges || []) as DecorationRangeEntry[],
      );
    }
  });

  window.addEventListener("devyy-extension-host-reset", () => {
    clearExtensionDecorations();
  });
}
