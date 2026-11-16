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

import { useEffect, useState } from "react";
import { discoverAIModels, loadAI, useAI } from "../lib/ai";
import type { Settings } from "../lib/types";
import Select from "./ui/Select";
import SuggestionInput from "./ui/SuggestionInput";
import { useAICompletionStatus } from "../lib/aiCompletion";
export default function CompletionSettings({
  settings,
  onChange,
  setup = false,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  setup?: boolean;
}) {
  const state = useAI();
  const completion = useAICompletionStatus();
  const [error, setError] = useState("");
  useEffect(() => {
    void loadAI();
  }, []);
  useEffect(() => {
    if (!settings.aiCompletionProvider) return;
    let current = true;
    setError("");
    void discoverAIModels(settings.aiCompletionProvider).catch((error) => {
      if (current) setError(String(error));
    });
    return () => {
      current = false;
    };
  }, [settings.aiCompletionProvider]);
  return (
    <section
      className="completion-settings"
      aria-label="AI completion settings"
    >
      {settings.aiCompletions && completion.error && (
        <p className="ai-error" role="status">
          {completion.error}
        </p>
      )}
      {settings.aiCompletions && !settings.autocomplete && (
        <p className="muted">Enable Code suggestions to use AI completions.</p>
      )}
      {setup && (
        <>
          <label className="setup-check">
            <input
              type="checkbox"
              checked={settings.autocomplete}
              onChange={(event) =>
                onChange({ autocomplete: event.target.checked })
              }
            />{" "}
            Code suggestions from language servers and this file
          </label>
          <label className="setup-check">
            <input
              type="checkbox"
              checked={settings.aiCompletions}
              onChange={(event) =>
                onChange({ aiCompletions: event.target.checked })
              }
            />{" "}
            AI code suggestions while typing
          </label>
          <p className="muted">
            AI suggestions send nearby code to your provider and consume tokens
            or credits in the background. Local and language-server suggestions
            do not use AI credits.
          </p>
        </>
      )}
      <div className="setting-row">
        <span>
          <strong>Completion provider</strong>
          <small>Automatic uses a configured provider.</small>
        </span>
        <Select
          aria-label="AI completion provider"
          value={settings.aiCompletionProvider}
          onChange={(event) =>
            onChange({
              aiCompletionProvider: event.target.value,
              aiCompletionModel: "",
            })
          }
        >
          <option value="">Automatic</option>
          {state.providers
            .filter((p) => p.enabled !== false)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
      </div>
      <div className="setting-row">
        <span>
          <strong>Completion model</strong>
          <small>
            Automatic prefers a small model from the provider catalog.
          </small>
        </span>
        <SuggestionInput
          aria-label="AI completion model"
          value={settings.aiCompletionModel}
          onChange={(event) =>
            onChange({ aiCompletionModel: event.target.value })
          }
          suggestions={state.models[settings.aiCompletionProvider] ?? []}
          placeholder="Automatic"
        />
      </div>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
