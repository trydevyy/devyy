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

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import Terminal from "./Terminal";
import type { AIProvider } from "../lib/ai";

export default function ProviderSignIn({
  provider,
  executable,
  disabled,
  onDone,
}: {
  provider: AIProvider;
  executable?: string;
  disabled: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [exited, setExited] = useState(false);
  const google = provider.kind === "antigravity";
  const options = useMemo(
    () => ({
      shellPath: executable,
      shellArgs: google ? ["acp", "--login"] : ["auth", "login"],
      name: `${provider.name} sign-in`,
    }),
    [executable, google, provider.name],
  );
  return (
    <div className="provider-sign-in">
      <div className="ai-provider-account-row">
        <span>
          <strong>{google ? "Google account" : "Provider account"}</strong>
          <small>
            {google
              ? "Use your Google account with Antigravity"
              : "Connect a provider through OpenCode"}
          </small>
        </span>
        <button
          className="setting-action"
          disabled={disabled || !executable || open}
          onClick={() => {
            setError("");
            setExited(false);
            setOpen(true);
          }}
        >
          <ExternalLink size={13} />
          {google ? "Sign in with Google" : "Connect an account"}
        </button>
      </div>
      {open && (
        <section
          className="provider-sign-in-session"
          aria-label={`${provider.name} sign-in`}
        >
          <p>
            {exited
              ? "Sign-in session closed. Refresh models to check the connection."
              : "Follow the sign-in steps below and in your browser. Return here when you’re finished."}
          </p>
          <div className="provider-sign-in-terminal">
            <Terminal
              root="provider-sign-in"
              extensionOptions={options}
              profile=""
              lineHeight={1.3}
              cursorStyle="bar"
              copyOnSelect={false}
              onReady={() => {}}
              onExit={() => setExited(true)}
              onError={(e) => setError(String(e))}
              onOpen={() => {}}
              theme={
                document.documentElement.dataset.theme === "paper"
                  ? "paper"
                  : "midnight"
              }
              fontSize={12}
              scrollback={1000}
              cursorBlink
            />
          </div>
          <button
            className="setting-action"
            onClick={() => {
              setOpen(false);
              onDone();
            }}
          >
            {exited ? "Done" : "Close sign-in session"}
          </button>
        </section>
      )}
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
