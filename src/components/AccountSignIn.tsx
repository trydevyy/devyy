import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, LogIn } from "lucide-react";
import {
  refreshAccountProfile,
  useAccountProfileState,
  type AccountProfile,
} from "../lib/account";
import { invoke, native } from "../lib/native";
import AccountAvatar from "./AccountAvatar";
import { showError } from "./ui/ErrorToast";

export function useAccountProfile() {
  return useAccountProfileState().profile;
}

export default function AccountSignIn({
  profile,
}: {
  profile: AccountProfile | null | undefined;
}) {
  const [opening, setOpening] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const { error } = useAccountProfileState();
  async function signIn() {
    setOpening(true);
    try {
      const { url } = await invoke<{ url: string }>("account_begin");
      await openUrl(url);
    } catch (cause) {
      showError(cause);
    } finally {
      setOpening(false);
    }
  }
  return (
    <div
      className="workbench-account-header"
      aria-busy={retrying || (profile === undefined && !error)}
    >
      <AccountAvatar large />
      <div>
        <strong>{profile?.name ?? "Your Devyy account"}</strong>
        <p>
          {profile?.email ??
            "Sync your preferences across devices and use private forwarded ports."}
        </p>
        {error && <p role="status">{error}</p>}
      </div>
      {error && (
        <button
          className="button"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            void refreshAccountProfile(true)?.finally(() => setRetrying(false));
          }}
        >
          Retry account
        </button>
      )}
      {(profile === null || (!profile && error)) && (
        <button
          className="button primary"
          disabled={!native || opening}
          onClick={() => void signIn()}
        >
          <LogIn size={14} /> {opening ? "Opening browser…" : "Sign in"}{" "}
          <ExternalLink size={11} />
        </button>
      )}
    </div>
  );
}
