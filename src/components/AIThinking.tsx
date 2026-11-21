import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  LoaderCircle,
  Terminal,
} from "lucide-react";
import type { AITool } from "../lib/ai";

const names: Record<string, string> = {
  read_file: "Read file",
  read_files: "Read files",
  list_files: "List files",
  search_files: "Search files",
  find_files: "Find files",
  run_command: "Run command",
  propose_edit: "Propose edit",
  write_file: "Write file",
  move_file: "Move file",
  delete_file: "Delete file",
  vcs_status: "Check source control",
  vcs_diff: "Inspect changes",
  vcs_checkpoint: "Save checkpoint",
  qa_check: "Run checks",
};

export default function AIThinking({
  text = "",
  tools = [],
  active = false,
}: {
  text?: string;
  tools?: AITool[];
  active?: boolean;
  startedAt?: number;
  finishedAt?: number;
}) {
  const current = tools.find((tool) => tool.status === "running");
  const label = active
    ? current
      ? (names[current.name] ?? "Using a tool")
      : "Working"
    : tools.length
      ? `${tools.length} ${tools.length === 1 ? "tool call" : "tool calls"}`
      : "Reasoning";
  const icon = active ? (
    <LoaderCircle size={13} className="spinning" />
  ) : tools.length ? (
    <Terminal size={13} />
  ) : (
    <CircleDashed size={13} />
  );
  if (!tools.length && !text) {
    return active ? (
      <div className="agent-activity-label" role="status">
        {icon}
        <span>{label}</span>
      </div>
    ) : null;
  }
  return (
    <details className="agent-activity">
      <summary className="agent-activity-label">
        {icon}
        <span>{label}</span>
        <ChevronDown size={12} />
      </summary>
      {tools.length > 0 && (
        <ul aria-label="Tool activity">
          {tools.map((tool) => (
            <li key={tool.id}>
              {tool.status === "error" ? (
                <CircleAlert size={13} aria-label="Failed" />
              ) : tool.status === "running" ? (
                <LoaderCircle
                  size={13}
                  className="spinning"
                  aria-label="Running"
                />
              ) : (
                <Check size={13} aria-label="Complete" />
              )}
              <span>
                <strong>
                  {names[tool.name] ?? tool.name.replaceAll("_", " ")}
                </strong>
                {(tool.detail || tool.path) && (
                  <small title={tool.detail || tool.path}>
                    {tool.detail || tool.path}
                  </small>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {text && (
        <details className="agent-reasoning">
          <summary>Reasoning</summary>
          <p>{text}</p>
        </details>
      )}
    </details>
  );
}
