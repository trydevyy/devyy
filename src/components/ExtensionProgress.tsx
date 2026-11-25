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

import { useExtensionInstall } from "../lib/extensionInstall";
const labels = {
  resolving: "Preparing download…",
  downloading: "Downloading…",
  installing: "Installing…",
  activating: "Finishing setup…",
};
function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const unit = value < 1024 * 1024 ? 1024 : 1024 * 1024;
  return `${(value / unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit === 1024 ? "KiB" : "MiB"}`;
}
export function InstallProgress({
  name,
  status,
  detail,
  ratio,
}: {
  name: string;
  status: string;
  detail?: string;
  ratio?: number;
}) {
  const percent = ratio === undefined ? undefined : Math.floor(ratio * 100);
  return (
    <div className="card-install-progress">
      <div className="extension-progress-label">
        <span role="status">{status}</span>
        {detail && (
          <span>
            <span className="extension-progress-bytes" title={detail}>
              {detail}
            </span>
            {percent !== undefined && (
              <span className="extension-progress-percent">{percent}%</span>
            )}
          </span>
        )}
      </div>
      <div
        className={`extension-progress-track ${ratio === undefined ? "indeterminate" : ""}`}
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={detail ?? status}
      >
        <div
          className="extension-progress-fill"
          style={{ transform: `scaleX(${ratio ?? 1})` }}
        />
      </div>
    </div>
  );
}

export default function ExtensionProgress({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const progress = useExtensionInstall(id);
  if (!progress) return null;
  const downloading = progress.phase === "downloading";
  const completeDownload =
    progress.phase === "installing" || progress.phase === "activating";
  const ratio = completeDownload
    ? 1
    : progress.total
      ? Math.min(1, progress.downloaded / progress.total)
      : undefined;
  const detail = downloading
    ? progress.total
      ? `${bytes(progress.downloaded)} / ${bytes(progress.total)}`
      : `${bytes(progress.downloaded)} downloaded`
    : undefined;
  return (
    <InstallProgress
      key={progress.packageId ?? progress.id}
      name={`${name} download`}
      status={
        progress.packageId
          ? `${labels[progress.phase]} ${progress.packageId}`
          : labels[progress.phase]
      }
      detail={detail}
      ratio={ratio}
    />
  );
}
