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

import { ExtensionProgress } from "./ExtensionServices";
import { useEffect } from "react";
import {
  Check,
  CircleAlert,
  Info,
  LoaderCircle,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  clearStatusMessage,
  extensionCommand,
  useExtensionHost,
} from "../lib/extensionHost";

function renderCodicon(name: string, key: number) {
  const isSpin = name.endsWith("~spin");
  const baseName = isSpin ? name.slice(0, -5) : name;
  const spinClass = isSpin ? "spinning" : undefined;

  switch (baseName) {
    case "sync":
    case "loading":
    case "refresh":
      return (
        <LoaderCircle
          key={key}
          size={12}
          className={spinClass ?? (isSpin ? "spinning" : undefined)}
        />
      );
    case "error":
    case "circle-slash":
      return <CircleAlert key={key} size={12} className="status-error-icon" />;
    case "warning":
    case "alert":
      return (
        <TriangleAlert key={key} size={12} className="status-warning-icon" />
      );
    case "check":
    case "pass":
      return <Check key={key} size={12} />;
    case "zap":
      return <Zap key={key} size={12} />;
    case "info":
      return <Info key={key} size={12} />;
    default:
      if (isSpin) {
        return <LoaderCircle key={key} size={12} className="spinning" />;
      }
      return null;
  }
}

function parseStatusText(text: string) {
  if (!text) return { parts: [], hasSpin: false };
  const parts: React.ReactNode[] = [];
  const regex = /\$\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  let hasSpin = false;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const iconName = match[1];
    if (
      iconName.endsWith("~spin") ||
      iconName === "sync" ||
      iconName === "loading"
    ) {
      hasSpin = true;
    }
    const iconNode = renderCodicon(iconName, key++);
    if (iconNode) {
      parts.push(iconNode);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return { parts, hasSpin };
}

export default function ExtensionStatusItems() {
  const { statusItems, statusMessage, statusMessageKind } = useExtensionHost();

  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => {
      clearStatusMessage();
    }, 7000);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const items = Object.entries(statusItems).sort(
    ([, a], [, b]) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  return (
    <>
      <ExtensionProgress />
      {items.map(([key, item]) => {
        const { parts, hasSpin } = parseStatusText(item.text);
        const shouldShowBusySpin = Boolean(item.busy && !hasSpin);
        const bgColorId =
          typeof item.backgroundColor === "string"
            ? item.backgroundColor
            : item.backgroundColor?.id;
        const isError =
          item.severity === 2 || Boolean(bgColorId?.includes("error"));
        const isWarning =
          item.severity === 1 || Boolean(bgColorId?.includes("warning"));

        const tooltip =
          (typeof item.tooltip === "string"
            ? item.tooltip
            : item.tooltip?.value) ||
          item.detail ||
          item.text.replace(/\$\(([^)]+)\)/g, "").trim();

        return (
          <button
            key={key}
            className={`extension-status-item${isError ? " status-item-error" : ""}${isWarning ? " status-item-warning" : ""}`}
            title={tooltip}
            onClick={() => {
              const command =
                typeof item.command === "string"
                  ? item.command
                  : item.command?.command;
              if (command) {
                void extensionCommand(
                  command,
                  typeof item.command === "object"
                    ? item.command.arguments
                    : [],
                ).catch((error) => toast.error(String(error)));
              }
            }}
          >
            {shouldShowBusySpin && (
              <LoaderCircle size={12} className="spinning" />
            )}
            {parts}
            {item.detail && (
              <span className="extension-status-detail">{item.detail}</span>
            )}
          </button>
        );
      })}

      {statusMessage && (
        <span
          className={`extension-status-message ${statusMessageKind || "info"}`}
          title={statusMessage}
        >
          {statusMessageKind === "error" ? (
            <CircleAlert size={12} className="status-error-icon" />
          ) : statusMessageKind === "warning" ? (
            <TriangleAlert size={12} className="status-warning-icon" />
          ) : (
            <Info size={12} />
          )}
          <span className="extension-status-message-text">{statusMessage}</span>
          <button
            type="button"
            className="extension-status-message-clear"
            onClick={(e) => {
              e.stopPropagation();
              clearStatusMessage();
            }}
            title="Dismiss status"
          >
            <X size={10} />
          </button>
        </span>
      )}
    </>
  );
}
