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

import Skeleton from "./ui/Skeleton";
import ErrorToast from "./ui/ErrorToast";
import { useEffect, useState } from "react";
import { Code, ImageOff, Maximize, Minus, Plus } from "lucide-react";
import { invoke } from "../lib/native";
import type { FilePreviewKind } from "../lib/filePreview";
export default function FilePreview({
  path,
  kind,
  source,
  onSource,
}: {
  path: string;
  kind: FilePreviewKind;
  source?: string;
  onSource?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState("");
  useEffect(() => {
    let current = true;
    setUrl("");
    setError("");
    setDimensions("");
    setZoom(null);
    if (source !== undefined) {
      setUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
    } else {
      void invoke<string>(
        kind === "image" ? "read_preview_image" : "read_preview_media",
        { path },
      )
        .then((value) => {
          if (current) setUrl(value);
        })
        .catch((error) => {
          if (current) setError(String(error));
        });
    }
    return () => {
      current = false;
    };
  }, [path, kind, source]);
  return (
    <section className="file-preview" aria-label={`Preview ${path}`}>
      <header className="file-preview-toolbar">
        <span>
          {kind === "image"
            ? dimensions || "Image"
            : kind === "audio"
              ? "Audio"
              : "Video"}
        </span>
        {kind === "image" && (
          <>
            <button
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() =>
                setZoom((value) => Math.max(0.1, (value ?? 1) / 1.25))
              }
            >
              <Minus size={14} />
            </button>
            <button
              className="preview-zoom"
              title="Actual size"
              onClick={() => setZoom(1)}
            >
              {zoom === null ? "Fit" : `${Math.round(zoom * 100)}%`}
            </button>
            <button
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() =>
                setZoom((value) => Math.min(8, (value ?? 1) * 1.25))
              }
            >
              <Plus size={14} />
            </button>
            <button
              title="Fit image"
              aria-label="Fit image"
              onClick={() => setZoom(null)}
            >
              <Maximize size={14} />
            </button>
          </>
        )}
        {onSource && (
          <button onClick={onSource}>
            <Code size={14} /> Source
          </button>
        )}
      </header>
      <div
        className={`file-preview-canvas ${zoom === null ? "fit" : "zoomed"}`}
      >
        {error ? (
          <div className="file-preview-error" role="status">
            <ImageOff size={26} />
            <strong>Preview unavailable</strong>
            <ErrorToast message={error} />
          </div>
        ) : !url ? (
          <Skeleton variant="media" label="Loading file preview" />
        ) : kind === "image" ? (
          <img
            src={url}
            alt={path}
            draggable={false}
            onError={() =>
              setError(
                "This image format cannot be decoded by your system webview.",
              )
            }
            onLoad={(event) =>
              setDimensions(
                `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
              )
            }
            style={
              zoom === null
                ? undefined
                : {
                    width: dimensions
                      ? `${Number(dimensions.split(" × ")[0]) * zoom}px`
                      : undefined,
                    maxWidth: "none",
                    maxHeight: "none",
                  }
            }
          />
        ) : kind === "audio" ? (
          <audio
            src={url}
            controls
            preload="metadata"
            onError={() =>
              setError("This audio format cannot be played on this system.")
            }
          />
        ) : (
          <video
            src={url}
            controls
            preload="metadata"
            onError={() =>
              setError("This video format cannot be played on this system.")
            }
          />
        )}
      </div>
    </section>
  );
}
