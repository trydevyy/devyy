export default function Skeleton({
  label,
  variant = "lines",
}: {
  label: string;
  variant?: "lines" | "inline" | "workbench" | "cards";
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`editor-skeleton editor-skeleton-${variant}`}
    >
      <span aria-hidden="true" />
      {variant !== "inline" && (
        <>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </>
      )}
    </span>
  );
}
