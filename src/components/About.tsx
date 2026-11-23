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

import { writeClipboardText } from "../lib/clipboard";
import ErrorToast from "./ui/ErrorToast";
import { useEffect, useState } from "react";
import { Asterisk, ArrowUpRight, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getBuildInfo,
  checkUpdates,
  type BuildInfo,
  type UpdateStatus,
} from "../lib/buildInfo";
import { native } from "../lib/native";
export default function About({
  onViewUpdate,
}: {
  onViewUpdate: (url: string) => Promise<void>;
}) {
  const [info, setInfo] = useState<BuildInfo>();
  const [error, setError] = useState("");
  const [update, setUpdate] = useState<UpdateStatus>();
  const [updateError, setUpdateError] = useState("");
  const [busy, setBusy] = useState(native);
  useEffect(() => {
    let current = true;
    void getBuildInfo()
      .then((value) => {
        if (current) setInfo(value);
      })
      .catch(() => {
        if (current) setError("Build details are unavailable.");
      });
    if (native)
      void checkUpdates()
        .then((value) => {
          if (current) setUpdate(value);
        })
        .catch((e) => {
          if (current) setUpdateError(String(e));
        })
        .finally(() => {
          if (current) setBusy(false);
        });
    return () => {
      current = false;
    };
  }, []);
  const builtAt = info ? new Date(Number(info.builtAt) * 1000) : null;
  const date =
    builtAt && !Number.isNaN(builtAt.getTime())
      ? builtAt.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "long",
        })
      : "Unavailable";
  const updateText = busy
    ? "Checking for updates…"
    : updateError
      ? "Could not check for updates"
      : update?.status === "available"
        ? `${update.version} is available`
        : update?.status === "current"
          ? "Up to date"
          : update?.status === "unpublished"
            ? "No public release available"
            : "Available in the desktop app";
  return (
    <section className="about-details" aria-label="About devyy">
      <div className="about-app">
        <Asterisk size={36} />
        <div>
          <h3>devyy</h3>
          <span>{info?.version ?? "Loading…"}</span>
        </div>
      </div>
      {error ? (
        <p role="status">{error}</p>
      ) : (
        <dl>
          <div>
            <dt>Version</dt>
            <dd>{info?.version ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd>
              {info
                ? `${info.revision}${info.arch === "—" ? "" : ` (${info.arch})`}`
                : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Built on</dt>
            <dd>{date}</dd>
          </div>
          <div>
            <dt>Operating system</dt>
            <dd>{info?.os ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>OS build</dt>
            <dd>{info?.osBuild ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>Updates</dt>
            <dd role="status">{updateText}</dd>
          </div>
        </dl>
      )}
      {updateError && <ErrorToast message={updateError} />}
      <div className="about-buttons">
        <button
          className="setting-action"
          disabled={!native || busy}
          onClick={() => {
            setBusy(true);
            setUpdateError("");
            void checkUpdates(true)
              .then(setUpdate)
              .catch((e) => setUpdateError(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          <RefreshCw size={13} className={busy ? "spinning" : ""} />
          Check for updates
        </button>
        {update?.status === "available" && update.url && (
          <button
            className="setting-action about-release-button"
            aria-label="View release"
            onClick={() => update.url && void onViewUpdate(update.url)}
          >
            Get v{update.version}
            <ArrowUpRight size={13} />
          </button>
        )}
        <button
          className="setting-action"
          disabled={!info}
          onClick={() =>
            void writeClipboardText(
              `devyy ${info!.version}\nBuild ${info!.revision} (${info!.arch})\nBuilt ${date}\n${info!.os} ${info!.osBuild}`,
            )
              .then(() => toast.success("App details copied"))
              .catch(() => toast.error("Could not copy app details"))
          }
        >
          <Copy size={13} />
          Copy app details
        </button>
      </div>
    </section>
  );
}
