import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import ExtensionWebviews from "./ExtensionWebviews";
import { extensionMenuItems } from "../lib/extensionMenus";
import { useContextMenu } from "./ContextMenu";
import { matchesContext } from "../lib/extensionContext";
import { useExtensions } from "../lib/extensions";
import {
  extensionCommand,
  hostRequest,
  useExtensionHost,
  type HostEvent,
  type NativeNode,
} from "../lib/extensionHost";
interface TreeNode {
  key: string;
  label: string;
  description?: string;
  tooltip?: string;
  collapsibleState: number;
  icon?: string;
  command?: { command: string };
  contextValue?: string;
}
function TreeBranch({
  id,
  parent,
  depth = 0,
}: {
  id: string;
  parent?: string;
  depth?: number;
}) {
  const extensions = useExtensions(),
    host = useExtensionHost(),
    openMenu = useContextMenu();
  const [items, setItems] = useState<TreeNode[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    void hostRequest<TreeNode[]>("tree", { id, parent })
      .then((result) => {
        if (disposed) return;
        setItems(result ?? []);
        setOpen(
          new Set(
            (result ?? [])
              .filter((n) => n.collapsibleState === 2)
              .map((n) => n.key),
          ),
        );
      })
      .catch((error) => {
        if (!disposed) setError(String(error));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [id, parent, revision]);
  useEffect(() => {
    // Refresh roots only: their node handles invalidate all previous branches.
    if (parent) return;
    const listener = (event: Event) => {
      const message = (event as CustomEvent<HostEvent>).detail;
      if (message.event === "treeChanged" && message.payload.id === id)
        setRevision((n) => n + 1);
    };
    window.addEventListener("devyy-extension-event", listener);
    return () => window.removeEventListener("devyy-extension-event", listener);
  }, [id, parent]);
  if (depth > 32)
    return (
      <p className="extension-view-note">This tree is too deeply nested.</p>
    );
  if (loading)
    return (
      <div className="extension-view-note" role="status">
        <LoaderCircle className="spinning" size={12} /> Loading…
      </div>
    );
  if (error)
    return (
      <div className="extension-view-note" role="status">
        <p>{error}</p>
        <button onClick={() => setRevision((n) => n + 1)}>Try again</button>
      </div>
    );
  return (
    <div
      role={parent ? "group" : "tree"}
      aria-label={parent ? undefined : id}
      key={revision}
    >
      {items.map((item) => (
        <div key={item.key}>
          <button
            role="treeitem"
            aria-expanded={
              item.collapsibleState ? open.has(item.key) : undefined
            }
            className="extension-tree-row"
            style={{ paddingLeft: 12 + depth * 14 }}
            title={item.tooltip}
            onContextMenu={(event) => {
              const items = extensionMenuItems(
                extensions,
                "view/item/context",
                { ...host.contexts, view: id, viewItem: item.contextValue },
                (command) =>
                  void hostRequest("treeMenuCommand", {
                    id,
                    key: item.key,
                    command,
                  }).catch((error) => toast.error(String(error))),
              );
              if (items.length) openMenu(event, items);
            }}
            onClick={() => {
              if (item.collapsibleState)
                setOpen((previous) => {
                  const next = new Set(previous);
                  if (next.has(item.key)) next.delete(item.key);
                  else next.add(item.key);
                  return next;
                });
              if (item.command)
                void hostRequest("treeCommand", { id, key: item.key }).catch(
                  (e) => toast.error(String(e)),
                );
            }}
          >
            {item.collapsibleState ? (
              open.has(item.key) ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )
            ) : (
              <span className="tree-chevron-space" />
            )}
            {item.collapsibleState ? <Folder size={13} /> : <File size={13} />}
            <span>{item.label}</span>
            <small>{item.description}</small>
          </button>
          {open.has(item.key) && (
            <TreeBranch id={id} parent={item.key} depth={depth + 1} />
          )}
        </div>
      ))}
      {!parent && !items.length && (
        <p className="extension-view-note">No items to display.</p>
      )}
    </div>
  );
}
function NativeControl({
  node,
  depth = 0,
}: {
  node: NativeNode;
  depth?: number;
}) {
  if (!node || depth > 24) return null;
  switch (node.type) {
    case "heading":
      return <h4>{node.text}</h4>;
    case "text":
      return <p>{node.text}</p>;
    case "badge":
      return <span className="extension-native-badge">{node.text}</span>;
    case "button":
      return (
        <button
          className="setting-action"
          onClick={() => {
            if (node.command)
              void extensionCommand(node.command, node.args).catch((e) =>
                toast.error(String(e)),
              );
          }}
        >
          {node.text}
        </button>
      );
    case "input":
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("value");
            if (node.command)
              void extensionCommand(node.command, [
                value,
                ...(node.args ?? []),
              ]).catch((e) => toast.error(String(e)));
          }}
        >
          <input
            name="value"
            aria-label={node.text ?? node.placeholder ?? "Extension input"}
            placeholder={node.placeholder}
          />
          <button type="submit" className="setting-action">
            {node.text ?? "Submit"}
          </button>
        </form>
      );
    case "stack":
      return (
        <div className="extension-native-stack">
          {node.children?.slice(0, 500).map((child, index) => (
            <NativeControl key={index} node={child} depth={depth + 1} />
          ))}
        </div>
      );
    default:
      return null;
  }
}
function ContributedView({
  id,
  name,
  webview,
}: {
  id: string;
  name: string;
  webview: boolean;
}) {
  const extensions = useExtensions(),
    host = useExtensionHost(),
    openMenu = useContextMenu();
  const [expanded, setExpanded] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (webview && expanded)
      void hostRequest("resolveView", { id }).catch((e) => setError(String(e)));
  }, [id, webview, expanded, revision]);
  return (
    <section className="extension-view" aria-label={name}>
      <div
        className="extension-view-heading"
        onContextMenu={(event) => {
          const items = extensionMenuItems(
            extensions,
            "view/title",
            { ...host.contexts, view: id },
            (command) =>
              void extensionCommand(command).catch((error) =>
                toast.error(String(error)),
              ),
          );
          if (items.length) openMenu(event, items);
        }}
      >
        <button
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{" "}
          {name}
        </button>
        <button
          aria-label={`Refresh ${name}`}
          onClick={() => {
            setError("");
            setRevision((n) => n + 1);
          }}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="extension-view-body" hidden={!expanded}>
        {webview ? (
          error ? (
            <p className="extension-view-note" role="alert">
              {error}
            </p>
          ) : (
            <ExtensionWebviews
              placement="view"
              viewId={id}
              visible={expanded}
            />
          )
        ) : (
          <TreeBranch key={revision} id={id} />
        )}
      </div>
    </section>
  );
}
export default function ExtensionViews({ container }: { container: string }) {
  const extensions = useExtensions();
  const host = useExtensionHost();
  const views = extensions
    .filter((e) => e.enabled)
    .flatMap((ext) =>
      (ext.contributes.views?.[container] ?? []).map((view) => ({
        ...view,
        extension: ext.id,
      })),
    )
    .filter((view) => matchesContext(view.when, host.contexts));
  const natives = container === "devyy" ? host.views : [];
  const run = useCallback((command: string) => {
    void extensionCommand(command).catch((e) => toast.error(String(e)));
  }, []);
  return (
    <div className="extension-views">
      {views.map((view) => (
        <ContributedView
          key={view.id}
          id={view.id}
          name={view.name}
          webview={view.type === "webview"}
        />
      ))}
      {natives.map((view) => (
        <section
          className="extension-view"
          aria-label={view.title ?? view.id}
          key={view.id}
        >
          <div className="extension-view-heading">{view.title ?? view.id}</div>
          <div className="extension-native-content">
            {Array.isArray(view.body) &&
              view.body
                .slice(0, 500)
                .map((node, index) => (
                  <NativeControl key={index} node={node} />
                ))}
          </div>
        </section>
      ))}
      {container === "devyy" &&
        extensions
          .filter((e) => e.enabled)
          .flatMap((e) => e.contributes.commands ?? [])
          .map((command) => (
            <button
              className="extension-command"
              key={command.command}
              onClick={() => run(command.command)}
            >
              {command.title}
            </button>
          ))}
    </div>
  );
}
