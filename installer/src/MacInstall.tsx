import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { ArrowRight, Folder } from "lucide-react";
import Mark, { dragImage } from "./Mark";
export default function MacInstall({
  source,
  dark,
  onInstall,
  onInstalled,
  onError,
}: {
  source?: string;
  dark: boolean;
  onInstall: () => void;
  onInstalled: () => void;
  onError: (error: string) => void;
}) {
  const target = useRef<HTMLButtonElement>(null),
    install = useRef(onInstall),
    finished = useRef(onInstalled);
  install.current = onInstall;
  finished.current = onInstalled;
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!isTauri() || !source) return;
    let disposed = false,
      stop: (() => void) | undefined,
      scale = 1;
    void getCurrentWindow()
      .scaleFactor()
      .then((value) => {
        scale = value || 1;
      });
    void getCurrentWindow()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") {
          setOver(false);
          return;
        }
        const rect = target.current?.getBoundingClientRect();
        const inside =
          rect &&
          payload.position.x / scale >= rect.left &&
          payload.position.x / scale <= rect.right &&
          payload.position.y / scale >= rect.top &&
          payload.position.y / scale <= rect.bottom;
        setOver(!!inside);
        if (
          payload.type === "drop" &&
          inside &&
          payload.paths.includes(source)
        ) {
          setOver(false);
          install.current();
        }
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      });
    const verify = () => {
      void invoke<boolean>("installer_macos_status")
        .then((installed) => {
          if (!disposed && installed) finished.current();
        })
        .catch(() => {});
    };
    window.addEventListener("focus", verify);
    return () => {
      window.removeEventListener("focus", verify);
      disposed = true;
      stop?.();
    };
  }, [source]);
  async function drag() {
    if (!source || !isTauri()) return;
    try {
      await startDrag(
        { item: [source], icon: dragImage(dark), mode: "copy" },
        async (result) => {
          setOver(false);
          if (result.result === "Dropped") {
            try {
              if (await invoke<boolean>("installer_macos_status"))
                finished.current();
            } catch (error) {
              onError(String(error));
            }
          }
        },
      );
    } catch (error) {
      onError(String(error));
    }
  }
  return (
    <div className="mac-install">
      <div className="mac-intro">
        <h1>Install Devyy</h1>
        <p>Drag Devyy to Applications to install.</p>
      </div>
      <div className="mac-stage">
        <div className="mac-source">
          <button
            aria-label="Drag Devyy to Applications"
            disabled={!source}
            onMouseDown={(event) => {
              if (event.button === 0) void drag();
            }}
            onClick={(event) => {
              if (event.detail === 0) target.current?.focus();
            }}
            draggable={!isTauri()}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-devyy-app", "devyy");
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            <Mark />
          </button>
          <strong>Devyy</strong>
        </div>
        <ArrowRight className="mac-connector" size={24} strokeWidth={1} />
        <div className="mac-destination">
          <button
            ref={target}
            className={over ? "drop-active" : ""}
            aria-label="Install Devyy in Applications"
            disabled={!source}
            onClick={onInstall}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              if (event.dataTransfer.types.includes("application/x-devyy-app"))
                onInstall();
            }}
          >
            <Folder size={64} strokeWidth={1.2} />
          </button>
          <strong>{over ? "Release to install" : "Applications"}</strong>
        </div>
      </div>
      {!source && (
        <p className="notice">
          The Devyy app is missing. Download the installer again.
        </p>
      )}
    </div>
  );
}
