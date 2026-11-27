type Variant =
  | "lines"
  | "inline"
  | "workbench"
  | "media"
  | "settings"
  | "sidebar"
  | "table"
  | "terminal"
  | "output"
  | "diff"
  | "extensions"
  | "themes"
  | "servers";

function Block({
  width,
  className = "",
}: {
  width?: string;
  className?: string;
}) {
  return (
    <span
      className={`skeleton-block ${className}`}
      style={width ? { width } : undefined}
    />
  );
}

const lineWidths = ["42%", "66%", "34%", "58%", "51%", "73%", "39%", "62%"];

function CatalogCard({
  variant,
}: {
  variant: "extensions" | "themes" | "servers";
}) {
  return (
    <div className="skeleton-card">
      {variant === "themes" ? (
        <div className="skeleton-theme-preview">
          <Block />
          <div>
            <Block width="68%" />
            <Block width="42%" />
            <Block width="56%" />
          </div>
        </div>
      ) : (
        <Block className="skeleton-card-icon" />
      )}
      <div className="skeleton-card-copy">
        <Block width="68%" />
        <Block width="45%" />
        {variant !== "servers" && (
          <>
            <Block width="94%" />
            <Block width="76%" />
          </>
        )}
      </div>
      {variant === "servers" && (
        <Block width="80%" className="skeleton-card-detail" />
      )}
      <Block className="skeleton-card-action" />
    </div>
  );
}

function Rows({ variant }: { variant: "sidebar" | "table" | "settings" }) {
  return lineWidths.map((width, index) => (
    <div className="skeleton-row" key={width}>
      {variant !== "settings" && <Block className="skeleton-row-icon" />}
      <div className="skeleton-row-copy">
        <Block width={width} />
        {variant !== "sidebar" && (
          <Block width={lineWidths[(index + 2) % lineWidths.length]} />
        )}
      </div>
      {variant !== "sidebar" && <Block className="skeleton-row-action" />}
    </div>
  ));
}

export default function Skeleton({
  label,
  variant = "lines",
  count = 9,
}: {
  label: string;
  variant?: Variant;
  count?: number;
}) {
  const catalog =
    variant === "extensions" || variant === "themes" || variant === "servers";
  const Tag = variant === "inline" || variant === "lines" ? "span" : "div";
  return (
    <Tag
      role="status"
      aria-label={label}
      className={`editor-skeleton editor-skeleton-${variant}`}
    >
      {catalog ? (
        <div aria-hidden="true" className="skeleton-catalog">
          {Array.from({ length: count }, (_, index) => (
            <CatalogCard key={index} variant={variant} />
          ))}
        </div>
      ) : variant === "media" ? (
        <span
          className="skeleton-block skeleton-media-frame"
          aria-hidden="true"
        />
      ) : variant === "sidebar" || variant === "table" ? (
        <div aria-hidden="true" className="skeleton-list">
          <Block className="skeleton-toolbar" />
          <Rows variant={variant} />
        </div>
      ) : variant === "settings" ||
        variant === "workbench" ||
        variant === "diff" ? (
        <div className="skeleton-workspace" aria-hidden="true">
          <Block className="skeleton-toolbar" />
          <div className="skeleton-workspace-rail">
            <Rows variant="sidebar" />
          </div>
          <div className="skeleton-workspace-content">
            <Rows variant={variant === "settings" ? "settings" : "sidebar"} />
          </div>
        </div>
      ) : (
        <span className="skeleton-lines" aria-hidden="true">
          {(variant === "inline"
            ? ["100%"]
            : variant === "lines"
              ? lineWidths.slice(0, 3)
              : lineWidths.slice(0, variant === "terminal" ? 4 : 6)
          ).map((width) => (
            <span className="skeleton-line" key={width}>
              {variant === "output" && <Block className="skeleton-log-time" />}
              <Block width={width} />
            </span>
          ))}
        </span>
      )}
    </Tag>
  );
}
