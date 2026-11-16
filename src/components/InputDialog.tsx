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
import { Braces, X } from "lucide-react";
import ModalBackdrop from "./ui/ModalBackdrop";

export interface Dialog {
  title: string;
  description: string;
  initial: string;
  label: string;
  submit: (value: string) => Promise<void>;
}

export interface InputDialogProps {
  dialog: Dialog;
  onClose: () => void;
}

export default function InputDialog({ dialog, onClose }: InputDialogProps) {
  const [value, setValue] = useState(dialog.initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <ModalBackdrop className="modal-backdrop" onMouseDown={onClose}>
      <form
        noValidate
        className="input-modal"
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void dialog
            .submit(value.trim())
            .then(onClose)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="modal-heading">
          <Braces size={24} />
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <h2>{dialog.title}</h2>
        <p className="muted">{dialog.description}</p>
        <input
          className="text-input"
          autoFocus
          aria-label="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !value.trim()}>
            {busy ? "Working…" : dialog.label}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}
