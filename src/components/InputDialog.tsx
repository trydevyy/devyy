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

import { ModalActions, ModalHeader, MotionModalForm } from "./ui/ModalSurface";
import ErrorToast from "./ui/ErrorToast";
import { useState } from "react";
import { Braces } from "lucide-react";
import { useDialogMotion } from "../lib/motion";
import ModalBackdrop from "./ui/ModalBackdrop";

export interface Dialog {
  title: string;
  description: string;
  initial: string;
  placeholder?: string;
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

  const animation = useDialogMotion();
  return (
    <ModalBackdrop
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <MotionModalForm
        as="form"
        {...animation}
        noValidate
        className="input-modal compact-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="input-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || !value.trim()) return;
          setBusy(true);
          void dialog
            .submit(value.trim())
            .then(onClose)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <ModalHeader
          id="input-dialog-title"
          title={dialog.title}
          icon={<Braces size={18} />}
          onClose={onClose}
          closeLabel="Close dialog"
          busy={busy}
        />
        <div className="compact-dialog-content">
          <input
            className="text-input"
            autoFocus
            aria-label="Value"
            aria-describedby="input-dialog-hint"
            placeholder={dialog.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
          <p id="input-dialog-hint">{dialog.description}</p>
          {error && <ErrorToast message={error} />}
        </div>
        <ModalActions>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !value.trim()}
            aria-busy={busy}
          >
            {dialog.label}
          </button>
        </ModalActions>
      </MotionModalForm>
    </ModalBackdrop>
  );
}
