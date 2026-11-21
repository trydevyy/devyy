import { useEffect } from "react";
import { Toaster, toast } from "sonner";

export function showError(error: unknown) {
  const message = String(error)
    .replace(/^Error:\s*/, "")
    .trim();
  if (!message) return;
  const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const dialog = dialogs[dialogs.length - 1];
  const host = dialog?.querySelector<HTMLElement>("[data-toast-host]");
  toast.error(message, { id: message, toasterId: host?.dataset.toastHost });
}

export default function ErrorToast({ message }: { message?: string | null }) {
  useEffect(() => {
    if (message) showError(message);
  }, [message]);
  return null;
}

export function DialogToastHost({ id }: { id: string }) {
  return (
    <div data-toast-host={id}>
      <Toaster
        id={id}
        position="bottom-right"
        closeButton
        visibleToasts={2}
        toastOptions={{ className: "devyy-toast" }}
      />
    </div>
  );
}
