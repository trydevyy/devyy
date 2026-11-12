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
export function ExtensionInstallLabel({ id }: { id: string }) {
  const progress = useExtensionInstall(id);
  return <>{progress ? labels[progress.phase] : "Installing…"}</>;
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
  const percent = ratio === undefined ? undefined : Math.floor(ratio * 100);
  const text = downloading
    ? progress.total
      ? `${bytes(progress.downloaded)} / ${bytes(progress.total)}`
      : `${bytes(progress.downloaded)} downloaded`
    : labels[progress.phase];
  return (
    <div className="extension-progress">
      <div className="extension-progress-label">
        <span role="status">
          {progress.packageId && progress.packageId !== progress.id
            ? `${labels[progress.phase]} ${progress.packageId}`
            : downloading
              ? "Downloading"
              : labels[progress.phase]}
        </span>
        <span>
          {downloading ? text : completeDownload ? "Download complete" : ""}
          {downloading && percent !== undefined && (
            <span className="extension-progress-percent">{percent}%</span>
          )}
        </span>
      </div>
      <div
        key={progress.packageId ?? progress.id}
        className={`extension-progress-track ${ratio === undefined ? "indeterminate" : ""}`}
        role="progressbar"
        aria-label={`${name} download`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={downloading ? text : labels[progress.phase]}
      >
        <div
          className="extension-progress-fill"
          style={{ transform: `scaleX(${ratio ?? 1})` }}
        />
      </div>
    </div>
  );
}
