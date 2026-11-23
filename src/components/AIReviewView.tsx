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

import ErrorToast from "./ui/ErrorToast";
import { useState } from "react";
import {
  CheckCheck,
  Check,
  X,
  FileCode,
  FilePlus,
  LoaderCircle,
  AlertCircle,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import { useAI, setAIProposalStatus, type AIProposal } from "../lib/ai";
import { invoke, native } from "../lib/native";
import type { GitState } from "../lib/types";

export default function AIReviewView({
  cwd,
  onReview,
  onApproveAll,
}: {
  cwd?: string;
  onReview: (
    path: string,
    original: string,
    modified: string,
    create?: boolean,
    proposalId?: string,
  ) => void;
  onApproveAll?: (proposals?: AIProposal[]) => void;
}) {
  const ai = useAI();
  const chat = ai.conversations.find((c) => c.id === ai.selected);
  const [qaBusy, setQaBusy] = useState(false);
  const [qaResult, setQaResult] = useState<GitState>();
  const [qaError, setQaError] = useState("");

  // Collect all proposals across all messages in this conversation
  const proposals: AIProposal[] = [];
  chat?.messages.forEach((m) => {
    if (m.proposals) {
      m.proposals.forEach((p) => {
        // De-duplicate by id
        if (!proposals.some((existing) => existing.id === p.id)) {
          proposals.push(p);
        }
      });
    }
  });

  const pending = proposals.filter((p) => p.status === "pending");
  const applied = proposals.filter((p) => p.status === "applied");
  const dismissed = proposals.filter((p) => p.status === "dismissed");

  async function runQaCheck() {
    setQaBusy(true);
    setQaError("");
    try {
      setQaResult(undefined);
      setQaResult(await invoke<GitState>("git_status"));
    } catch (e) {
      setQaError(String(e));
    } finally {
      setQaBusy(false);
    }
  }

  const conflicts =
    qaResult?.changes.filter(
      ({ index, worktree }) =>
        index === "U" ||
        worktree === "U" ||
        ["AA", "DD"].includes(index + worktree),
    ).length ?? 0;

  function handleDiscardAll() {
    pending.forEach((p) => setAIProposalStatus(p.id, "dismissed"));
  }

  return (
    <div className="ai-review-view">
      <div className="ai-review-header">
        <div className="ai-review-summary">
          <h2>Review changes</h2>
          <small>
            {pending.length} pending · {applied.length} applied ·{" "}
            {dismissed.length} dismissed
          </small>
        </div>
        <div className="ai-review-actions-bar">
          <button
            className="setting-action"
            onClick={() => void runQaCheck()}
            disabled={qaBusy || !native || !cwd}
            title="Check Git status and merge conflicts"
          >
            {qaBusy ? (
              <LoaderCircle size={13} className="spinning" />
            ) : (
              <ShieldCheck size={13} />
            )}
            Check working tree
          </button>
          {pending.length > 0 && onApproveAll && (
            <button
              className="primary"
              onClick={() => onApproveAll(pending)}
              title="Apply all pending proposals"
            >
              <CheckCheck size={13} /> Apply All
            </button>
          )}
          {pending.length > 0 && (
            <button
              className="secondary"
              onClick={handleDiscardAll}
              title="Discard all pending proposals"
            >
              <X size={13} /> Discard All
            </button>
          )}
        </div>
      </div>

      {qaError && <ErrorToast message={qaError} />}

      {qaResult && (
        <section
          className="ai-qa-results-card"
          aria-label="Working tree"
          aria-live="polite"
        >
          {conflicts ? <AlertCircle size={15} /> : <Check size={15} />}
          <div>
            <strong>
              {conflicts
                ? `${conflicts} unresolved merge conflicts`
                : "No unresolved merge conflicts"}
            </strong>
            <p>
              {qaResult.branch === "detached"
                ? "Detached HEAD"
                : qaResult.branch}{" "}
              / {qaResult.changes.length} changed files
            </p>
          </div>
        </section>
      )}

      {proposals.length === 0 ? (
        <div className="ai-empty-review">
          <FileCode size={18} />
          <div>
            <strong>No proposed changes</strong>
            <p>
              Edits proposed in this conversation will appear here for review.
            </p>
          </div>
        </div>
      ) : (
        <div className="ai-proposals-list">
          {proposals.map((p) => (
            <div key={p.id} className={`ai-proposal-card status-${p.status}`}>
              <div className="ai-proposal-file">
                {p.create ? <FilePlus size={14} /> : <FileCode size={14} />}
                <strong>{p.path}</strong>
                <span className={`ai-proposal-status-badge ${p.status}`}>
                  {p.status}
                </span>
                {p.create && <span className="ai-badge-create">New file</span>}
              </div>

              <div className="ai-proposal-btns">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    onReview(p.path, p.original, p.modified, p.create, p.id)
                  }
                >
                  View diff
                </button>
                {p.status === "pending" && (
                  <>
                    {onApproveAll && (
                      <button
                        type="button"
                        className="setting-action"
                        onClick={() => onApproveAll([p])}
                      >
                        <Check size={12} /> Apply
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => setAIProposalStatus(p.id, "dismissed")}
                      aria-label="Dismiss"
                    >
                      <X size={12} />
                    </button>
                  </>
                )}
                {p.status !== "pending" && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setAIProposalStatus(p.id, "pending")}
                    title="Reset to pending"
                    aria-label="Reset to pending"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
