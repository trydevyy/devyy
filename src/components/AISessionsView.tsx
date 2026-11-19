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

import { useState } from "react";
import {
  Search,
  Plus,
  GitFork,
  Trash2,
  Pencil,
  Check,
  Bookmark,
  Calendar,
  MessageSquare,
} from "lucide-react";
import {
  deleteAIChat,
  forkAIChat,
  newAIChat,
  renameAIChat,
  selectAIChat,
  useAI,
  addAICheckpoint,
} from "../lib/ai";
import { invoke } from "../lib/native";

export default function AISessionsView({
  onSelectChat,
}: {
  onSelectChat: (chatId: string) => void;
}) {
  const ai = useAI();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointNotice, setCheckpointNotice] = useState("");

  const filtered = ai.conversations.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()),
  );

  async function handleCreateCheckpoint(chatId: string) {
    setCheckpointBusy(true);
    setCheckpointNotice("");
    try {
      const nowStr = new Date().toLocaleTimeString();
      const label = `Session checkpoint ${nowStr}`;
      const res = await invoke<string>("vcs_checkpoint", { name: label });
      addAICheckpoint(chatId, label);
      setCheckpointNotice(res || `Checkpoint created: ${label}`);
    } catch (err) {
      setCheckpointNotice(`Checkpoint error: ${String(err)}`);
    } finally {
      setCheckpointBusy(false);
    }
  }

  return (
    <div className="ai-sessions-view">
      <div className="ai-sessions-header">
        <div className="ai-sessions-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search session history…"
            aria-label="Search sessions"
          />
        </div>
        <button
          className="setting-action"
          onClick={() => {
            const providerId = ai.providers[0]?.id ?? "chatgpt";
            const nextId = newAIChat(providerId);
            if (nextId) onSelectChat(nextId);
          }}
          title="Start a new AI session"
        >
          <Plus size={13} /> New Session
        </button>
      </div>

      {checkpointNotice && (
        <p className="ai-provider-notice" role="status">
          {checkpointNotice}
        </p>
      )}

      <div className="ai-sessions-list">
        {filtered.map((c) => {
          const isSelected = c.id === ai.selected;
          const isRenaming = renaming === c.id;
          const msgCount = c.messages.length;
          const mode = c.mode ?? "agent";

          return (
            <div
              key={c.id}
              className={`ai-session-card ${isSelected ? "selected" : ""}`}
            >
              <div className="ai-session-card-header">
                {isRenaming ? (
                  <form
                    className="ai-session-rename-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      renameAIChat(c.id, renameTitle);
                      setRenaming(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={renameTitle}
                      onChange={(e) => setRenameTitle(e.target.value)}
                      aria-label="Rename session"
                    />
                    <button type="submit" className="icon-button" aria-label="Save">
                      <Check size={13} />
                    </button>
                  </form>
                ) : (
                  <div
                    className="ai-session-title-clickable"
                    onClick={() => {
                      selectAIChat(c.id);
                      onSelectChat(c.id);
                    }}
                  >
                    <MessageSquare size={14} className="ai-session-icon" />
                    <strong>{c.title}</strong>
                    <span className={`ai-mode-pill ${mode}`}>{mode}</span>
                  </div>
                )}

                <div className="ai-session-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title="Rename session"
                    aria-label="Rename session"
                    onClick={() => {
                      setRenaming(c.id);
                      setRenameTitle(c.title);
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title="Fork session"
                    aria-label="Fork session"
                    onClick={() => {
                      const lastMsg = c.messages.at(-1);
                      if (lastMsg) {
                        const forkedId = forkAIChat(c.id, lastMsg.id);
                        if (forkedId) onSelectChat(forkedId);
                      }
                    }}
                  >
                    <GitFork size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title="Create Hit/Git Checkpoint"
                    aria-label="Create Checkpoint"
                    disabled={checkpointBusy}
                    onClick={() => void handleCreateCheckpoint(c.id)}
                  >
                    <Bookmark size={12} />
                  </button>
                  {ai.conversations.length > 1 && (
                    <button
                      type="button"
                      className="icon-button danger"
                      title="Delete session"
                      aria-label="Delete session"
                      onClick={() => deleteAIChat(c.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              <div className="ai-session-meta">
                <span>
                  <Calendar size={11} /> {new Date(c.updatedAt).toLocaleDateString()}
                </span>
                <span>{msgCount} messages</span>
                {c.checkpoints && c.checkpoints.length > 0 && (
                  <span className="ai-session-checkpoint-count">
                    <Bookmark size={11} /> {c.checkpoints.length} checkpoints
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
