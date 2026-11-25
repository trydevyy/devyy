import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import type { HostEvent } from "../lib/extensionHost";
import type { StoreSprite, StoreTheme } from "../lib/store";

type ExtensionSprite = Omit<StoreSprite, "id"> & {
  unit: "px" | "%";
  animation?: { frames: number; fps: number; aspectRatio: number };
};

export type Editing = {
  selected?: string;
  onSelect: (id: string) => void;
  onMove: (id: string, position: Pick<StoreSprite, "x" | "y">) => void;
};

function EditableSprite({
  sprite,
  editing,
  style,
  className,
  index,
}: {
  sprite: StoreSprite;
  editing: Editing;
  style: CSSProperties;
  className: string;
  index: number;
}) {
  const drag = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  function start(event: PointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (event.button !== 0 || !bounds?.width || !bounds.height) return;
    drag.current = {
      x: event.clientX - (bounds.width * sprite.x) / 100,
      y: event.clientY - (bounds.height * sprite.y) / 100,
      width: bounds.width,
      height: bounds.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    editing.onSelect(sprite.id);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const initial = drag.current;
    if (!initial || !event.currentTarget.hasPointerCapture(event.pointerId))
      return;
    const percent = (offset: number, size: number) =>
      Math.round(Math.min(100, Math.max(0, (offset / size) * 100)) * 10) / 10;
    editing.onMove(sprite.id, {
      x: percent(event.clientX - initial.x, initial.width),
      y: percent(event.clientY - initial.y, initial.height),
    });
  }

  return (
    <button
      type="button"
      className={`${className} editable-sprite`}
      style={style}
      aria-label={`Select sprite ${index + 1}`}
      aria-pressed={editing.selected === sprite.id}
      onClick={() => editing.onSelect(sprite.id)}
      onPointerDown={start}
      onPointerMove={move}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    >
      <img src={sprite.image} alt="" draggable={false} />
    </button>
  );
}

function Sprite({
  sprite,
  editable,
}: {
  sprite: ExtensionSprite;
  editable?: { sprite: StoreSprite; editing: Editing; index: number };
}) {
  const style: CSSProperties = {
    left: `${sprite.x}${sprite.unit}`,
    top: `${sprite.y}${sprite.unit}`,
    width: `${sprite.width}${sprite.unit}`,
    opacity: sprite.opacity,
    transform: `translate(-50%, -50%) rotate(${sprite.rotation}deg)`,
  };
  const className = `workbench-sprite ${sprite.layer} ${/^data:image\/(gif|webp);/.test(sprite.image) ? "animated-image" : ""}`;
  if (editable)
    return <EditableSprite {...editable} style={style} className={className} />;
  if (!sprite.animation) {
    return (
      <img
        className={className}
        style={style}
        alt=""
        src={sprite.image}
        draggable={false}
      />
    );
  }
  const { frames, fps, aspectRatio } = sprite.animation;
  const sheetStyle = {
    ...style,
    aspectRatio,
    backgroundImage: `url("${sprite.image}")`,
    backgroundSize: `${frames * 100}% 100%`,
    "--sprite-steps": frames,
    "--sprite-end": `${(100 * frames) / (frames - 1)}%`,
    "--sprite-duration": `${frames / fps}s`,
  } as CSSProperties;
  return <span className={`${className} sprite-sheet`} style={sheetStyle} />;
}

export default function StoreSprites({
  theme,
  editing,
}: {
  theme?: StoreTheme;
  editing?: Editing;
}) {
  const [extensions, setExtensions] = useState<Record<string, ExtensionSprite>>(
    {},
  );
  useEffect(() => {
    const update = (event: Event) => {
      const { event: kind, payload } = (event as CustomEvent<HostEvent>).detail;
      if (kind !== "workbenchSprite" || typeof payload.key !== "string") return;
      const key = payload.key;
      if (!payload.sprite) {
        setExtensions((previous) => {
          if (!(key in previous)) return previous;
          const next = { ...previous };
          delete next[key];
          return next;
        });
      } else {
        const sprite = payload.sprite as ExtensionSprite;
        if (
          !/^data:image\/(png|jpeg|gif|webp);base64,[\w+/=]+$/.test(
            sprite.image,
          )
        )
          return;
        setExtensions((previous) => ({ ...previous, [key]: sprite }));
      }
    };
    const reset = () => setExtensions({});
    window.addEventListener("devyy-extension-event", update);
    window.addEventListener("devyy-extension-host-reset", reset);
    return () => {
      window.removeEventListener("devyy-extension-event", update);
      window.removeEventListener("devyy-extension-host-reset", reset);
    };
  }, []);
  return (
    <div className="workbench-sprites" aria-hidden={editing ? undefined : true}>
      {theme?.manifest.sprites.map(
        (sprite, index) =>
          sprite.anchor !== "titlebar" && (
            <Sprite
              key={`theme:${sprite.id}`}
              sprite={{ ...sprite, unit: "%" }}
              editable={editing ? { sprite, editing, index } : undefined}
            />
          ),
      )}
      {Object.entries(extensions).map(([id, sprite]) => (
        <Sprite key={id} sprite={sprite} />
      ))}
    </div>
  );
}

export function TitlebarStoreSprites({
  theme,
  editing,
}: {
  theme?: StoreTheme;
  editing?: Editing;
}) {
  const sprites = theme?.manifest.sprites.filter(
    (sprite) => sprite.anchor === "titlebar",
  );
  if (!sprites?.length) return null;
  return (
    <div
      className="titlebar-theme-sprites"
      aria-hidden={editing ? undefined : true}
    >
      {sprites.map((sprite) => {
        const media = (
          <img
            src={sprite.image}
            alt=""
            draggable={false}
            style={{
              opacity: sprite.opacity,
              transform: `rotate(${sprite.rotation}deg)`,
            }}
          />
        );
        return editing ? (
          <button
            type="button"
            key={sprite.id}
            aria-label={`Select sprite ${theme!.manifest.sprites.indexOf(sprite) + 1}`}
            onClick={() => editing.onSelect(sprite.id)}
            aria-pressed={editing.selected === sprite.id}
          >
            {media}
          </button>
        ) : (
          <span key={sprite.id}>{media}</span>
        );
      })}
    </div>
  );
}
