import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, LogIn } from "lucide-react";
import { accountRequest } from "../lib/account";
import { invoke, native } from "../lib/native";
import AccountAvatar from "./AccountAvatar";
import { showError } from "./ui/ErrorToast";

export interface AccountProfile {
  name: string;
  email: string;
}

export function useAccountProfile() {
  const [profile, setProfile] = useState<AccountProfile | null | undefined>(
    native ? undefined : null,
  );
  useEffect(() => {
    if (!native) return;
    let version = 0;
    function refresh() {
      const request = ++version;
      void accountRequest<AccountProfile>("/me").then(
        (user) => {
          if (version === request) setProfile(user ?? null);
        },
        () => {
          if (version === request) setProfile(null);
        },
      );
    }
    refresh();
    window.addEventListener("devyy-account-changed", refresh);
    return () => {
      version++;
      window.removeEventListener("devyy-account-changed", refresh);
    };
  }, []);
  return profile;
}

export default function AccountSignIn({
  profile,
}: {
  profile: AccountProfile | null | undefined;
}) {
  const [opening, setOpening] = useState(false);
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
    <div className="workbench-account-header" aria-busy={profile === undefined}>
      <AccountAvatar large />
      <div>
        <strong>{profile?.name ?? "Your Devyy account"}</strong>
        <p>
          {profile?.email ??
            "Sync your preferences across devices and use private forwarded ports."}
        </p>
      </div>
      {profile === null && (
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
