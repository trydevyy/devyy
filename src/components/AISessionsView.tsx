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
  Bookmark,
  Check,
  ChevronRight,
  GitFork,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  addAICheckpoint,
  deleteAIChat,
  forkAIChat,
  renameAIChat,
  useAI,
} from "../lib/ai";
import { invoke, native } from "../lib/native";
import ActionMenu, { ActionMenuItem } from "./ui/ActionMenu";

export default function AISessionsView({
  onSelectChat,
  onNewChat,
  canCheckpoint,
}: {
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  canCheckpoint: boolean;
}) {
  const ai = useAI();
  const [query, setQuery] = useState("");
  const [rename, setRename] = useState<{ id: string; title: string }>();
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const sessions = ai.conversations
    .filter((conversation) =>
      conversation.title.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);

  async function saveCheckpoint(id: string) {
    setCheckpointBusy(true);
    setNotice("");
    try {
      const label = `Session checkpoint ${new Date().toLocaleTimeString()}`;
      await invoke("vcs_checkpoint", { name: label });
      addAICheckpoint(id, label);
      setNotice("Checkpoint saved");
    } catch (error) {
      setNotice(String(error));
    } finally {
      setCheckpointBusy(false);
    }
  }

  return (
    <div className="session-history">
      <div className="session-history-header">
        <label className="session-history-search">
          <Search size={14} />
          <input
            aria-label="Search conversations"
            placeholder="Search conversations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          className="icon-button"
          aria-label="New conversation"
          title="New conversation"
          onClick={onNewChat}
        >
          <Plus size={16} />
        </button>
      </div>
      {notice && (
        <p className="session-history-notice" role="status">
          {notice}
        </p>
      )}
      <ul className="session-history-list">
        {!sessions.length && (
          <li className="session-history-empty">
            {query ? "No matching conversations" : "No conversations yet"}
          </li>
        )}
        {sessions.map((conversation) => {
          const selected = conversation.id === ai.selected;
          const lastMessage = conversation.messages.at(-1);
          const checkpoints = conversation.checkpoints?.length ?? 0;
          return (
            <li
              key={conversation.id}
              className="session-history-row"
              data-selected={selected}
            >
              {rename?.id === conversation.id ? (
                <form
                  className="session-history-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    renameAIChat(conversation.id, rename.title);
                    setRename(undefined);
                  }}
                >
                  <input
                    autoFocus
                    className="text-input"
                    value={rename.title}
                    aria-label="Conversation title"
                    onChange={(event) =>
                      setRename({
                        id: conversation.id,
                        title: event.target.value,
                      })
                    }
                  />
                  <button
                    type="submit"
                    className="icon-button"
                    aria-label="Save name"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Cancel rename"
                    onClick={() => setRename(undefined)}
                  >
                    <X size={14} />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="session-history-open"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelectChat(conversation.id)}
                  >
                    <MessageSquare size={14} aria-hidden="true" />
                    <span>
                      <strong>{conversation.title}</strong>
                      <small>
                        {new Date(conversation.updatedAt).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric", year: "numeric" },
                        )}
                        {checkpoints > 0 &&
                          ` / ${checkpoints} ${checkpoints === 1 ? "checkpoint" : "checkpoints"}`}
                      </small>
                    </span>
                    {selected ? (
                      <Check size={13} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={13} aria-hidden="true" />
                    )}
                  </button>
                  <ActionMenu label={`Actions for ${conversation.title}`}>
                    <ActionMenuItem
                      onClick={() =>
                        setRename({
                          id: conversation.id,
                          title: conversation.title,
                        })
                      }
                    >
                      <Pencil size={13} /> Rename
                    </ActionMenuItem>
                    <ActionMenuItem
                      disabled={!lastMessage}
                      onClick={() => {
                        if (!lastMessage) return;
                        const id = forkAIChat(conversation.id, lastMessage.id);
                        if (id) onSelectChat(id);
                      }}
                    >
                      <GitFork size={13} /> Branch conversation
                    </ActionMenuItem>
                    <ActionMenuItem
                      disabled={!native || !canCheckpoint || checkpointBusy}
                      onClick={() => void saveCheckpoint(conversation.id)}
                    >
                      <Bookmark size={13} /> Save checkpoint
                    </ActionMenuItem>
                    {ai.conversations.length > 1 && (
                      <ActionMenuItem
                        danger
                        onClick={() => deleteAIChat(conversation.id)}
                      >
                        <Trash2 size={13} /> Delete
                      </ActionMenuItem>
                    )}
                  </ActionMenu>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
