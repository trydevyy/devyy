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
import { Asterisk } from "lucide-react";
import type { UpdateProgress } from "../lib/buildInfo";

const stages: Record<UpdateProgress["stage"], string> = {
  checking: "Checking release files",
  downloading: "Downloading update",
  verifying: "Verifying download",
  installing: "Installing update",
  restarting: "Restarting Devyy",
};

export default function UpdateOverlay({
  version,
  progress,
  error,
  onClose,
}: {
  version: string;
  progress: UpdateProgress;
  error?: string;
  onClose: () => void;
}) {
  const percent =
    progress.total && progress.stage === "downloading"
      ? Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))
      : undefined;
  return (
    <NativeModal
      className="update-overlay"
      aria-labelledby="update-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (error) onClose();
      }}
    >
      <Asterisk size={30} strokeWidth={2} aria-hidden="true" />
      <h2 id="update-heading">
        {error ? "Update couldn’t finish" : `Updating to Devyy ${version}`}
      </h2>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button className="setting-action" onClick={onClose} autoFocus>
            Close
          </button>
        </>
      ) : (
        <>
          <p role="status">{stages[progress.stage]}</p>
          <div
            className="update-progress"
            role="progressbar"
            aria-label="Update progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            {percent !== undefined && <span style={{ width: `${percent}%` }} />}
          </div>
          {percent !== undefined && <small>{percent}%</small>}
        </>
      )}
    </NativeModal>
  );
}
