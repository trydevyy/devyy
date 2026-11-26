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

import { NativeModal } from "./ui/ModalSurface";
import { readClipboardText } from "../lib/clipboard";
import ErrorToast from "./ui/ErrorToast";
import { useMemo, useRef, useState } from "react";
import { Clipboard, ExternalLink, X } from "lucide-react";
import Terminal, { type TerminalHandle } from "./Terminal";
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
  const [succeeded, setSucceeded] = useState(false);
  const terminalRef = useRef<TerminalHandle>(null);
  const google = provider.kind === "antigravity";
  const options = useMemo(
    () => ({
      local: true,
      shellPath: executable,
      shellArgs: google ? ["acp", "--login"] : ["auth", "login"],
      name: `${provider.name} sign-in`,
    }),
    [executable, google, provider.name],
  );

  const pasteClipboard = () => {
    void readClipboardText()
      .then((text) => {
        if (text) {
          terminalRef.current?.paste(text);
          terminalRef.current?.focus();
        }
      })
      .catch((err) => setError(String(err)));
  };

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
            setSucceeded(false);
            setOpen(true);
          }}
        >
          <ExternalLink size={13} />
          {google ? "Sign in with Google" : "Connect an account"}
        </button>
      </div>
      {open && (
        <NativeModal
          className="provider-sign-in-session"
          data-escape-scope="active"
          aria-label={`${provider.name} sign-in`}
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
        >
          <header className="provider-sign-in-header">
            <h3>{provider.name} sign-in</h3>
            <button
              type="button"
              className="icon-button"
              aria-label="Cancel sign-in"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          <div className="provider-sign-in-header">
            <p>
              {exited
                ? succeeded
                  ? "Sign-in finished. Select Done to verify the connection."
                  : "Sign-in ended without a successful result."
                : "Follow the sign-in steps below and in your browser. Return here when you’re finished."}
            </p>
            {!exited && (
              <button
                type="button"
                className="setting-action provider-sign-in-paste"
                onClick={pasteClipboard}
                title="Paste from clipboard (Ctrl+V / right click)"
              >
                <Clipboard size={12} /> Paste
              </button>
            )}
          </div>
          <div
            className="provider-sign-in-terminal"
            onContextMenu={(e) => {
              e.preventDefault();
              pasteClipboard();
            }}
          >
            <Terminal
              ref={terminalRef}
              root="provider-sign-in"
              extensionOptions={options}
              profile=""
              lineHeight={1.3}
              cursorStyle="bar"
              copyOnSelect={false}
              onReady={() => {}}
              onExit={(success) => {
                setExited(true);
                setSucceeded(success === true);
              }}
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
              if (succeeded) onDone();
            }}
          >
            {exited ? "Done" : "Close sign-in session"}
          </button>
          {error && <ErrorToast message={error} />}
        </NativeModal>
      )}
      {!open && error && <ErrorToast message={error} />}
    </div>
  );
}
