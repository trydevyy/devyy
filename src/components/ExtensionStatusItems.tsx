import { toast } from "sonner";
import { extensionCommand, useExtensionHost } from "../lib/extensionHost";
export default function ExtensionStatusItems() {
  const { statusItems } = useExtensionHost();
  return (
    <>
      {Object.entries(statusItems)
        .sort(([, a], [, b]) => (b.priority ?? 0) - (a.priority ?? 0))
        .map(([key, item]) => (
          <button
            key={key}
            className="extension-status-item"
            title={
              typeof item.tooltip === "string"
                ? item.tooltip
                : item.tooltip?.value
            }
            onClick={() => {
              const command =
                typeof item.command === "string"
                  ? item.command
                  : item.command?.command;
              if (command)
                void extensionCommand(
                  command,
                  typeof item.command === "object"
                    ? item.command.arguments
                    : [],
                ).catch((error) => toast.error(String(error)));
            }}
          >
            {item.text.replace(/\$\(([^)]+)\)/g, "").trim()}
          </button>
        ))}
    </>
  );
}
