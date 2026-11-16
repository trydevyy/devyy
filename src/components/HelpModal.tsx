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

import { Asterisk, X } from "lucide-react";
import ModalBackdrop from "./ui/ModalBackdrop";

export interface HelpModalProps {
  onClose: () => void;
  bindings: Record<string, string>;
  commandInfo: ReadonlyArray<readonly [string, string, ...unknown[]]>;
  displayBinding: (binding: string) => string;
}

export default function HelpModal({
  onClose,
  bindings,
  commandInfo,
  displayBinding,
}: HelpModalProps) {
  return (
    <ModalBackdrop className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-label="About devyy and keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <button
            className="icon-button"
            aria-label="Close help"
            onClick={onClose}
          >
            <X size={20} />
          </button>
          <Asterisk size={34} className="devyy-modal-logo" />
        </div>
        <h2>Keyboard shortcuts</h2>
        <p className="muted">devyy 0.1</p>
        <div className="shortcut-list">
          {commandInfo
            .filter(([id]) => bindings[id])
            .map(([id, name]) => [name, displayBinding(bindings[id])])
            .map(([name, key]) => (
              <div key={name}>
                <span>{name}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
        </div>
      </section>
    </ModalBackdrop>
  );
}
