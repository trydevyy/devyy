import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { accountRequest, useSyncOptions } from "../lib/account";
import { native } from "../lib/native";

export default function AccountAvatar({ large = false }: { large?: boolean }) {
  const { server } = useSyncOptions();
  const [profile, setProfile] = useState<{
    id: string;
    name: string;
    avatar: boolean;
  }>();
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!native) return;
    let revision = 0;
    function refresh() {
      const request = ++revision;

      void accountRequest<{ id: string; name: string; avatar: boolean }>("/me")
        .then((user) => {
          if (request !== revision) return;
          setProfile(user);
          setFailed(false);
          setVersion(Date.now());
        })
        .catch(() => {
          if (request === revision) setProfile(undefined);
        });
    }
    refresh();
    window.addEventListener("devyy-account-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      revision++;
      window.removeEventListener("devyy-account-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [server]);
  return (
    <span
      className={
        large ? "account-avatar account-avatar-large" : "account-avatar"
      }
      aria-hidden="true"
    >
      {profile?.avatar && !failed ? (
        <img
          alt=""
          src={
            server.replace(/\/$/, "") +
            "/api/avatar/" +
            encodeURIComponent(profile.id) +
            "?v=" +
            version
          }
          onError={() => setFailed(true)}
        />
      ) : (
        profile?.name.trim().charAt(0).toUpperCase() || (
          <UserRound size={large ? 22 : 14} />
        )
      )}
    </span>
  );
}
