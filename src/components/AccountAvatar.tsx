import { useEffect, useState } from "react";
import { AtSign } from "lucide-react";
import { accountRequest, accountOrigin } from "../lib/account";
import { native } from "../lib/native";

export default function AccountAvatar({ large = false }: { large?: boolean }) {
  const [profile, setProfile] = useState<{
    id: string;
    name: string;
    avatar: boolean;
    origin: string;
  }>();
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!native) return;
    let revision = 0;
    function refresh() {
      const request = ++revision;

      void Promise.all([
        accountRequest<{ id: string; name: string; avatar: boolean }>("/me"),
        accountOrigin(),
      ])
        .then(([user, origin]) => {
          if (request !== revision) return;
          setProfile({ ...user, origin });
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
  }, []);
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
            profile.origin +
            "/api/avatar/" +
            encodeURIComponent(profile.id) +
            "?v=" +
            version
          }
          onError={() => setFailed(true)}
        />
      ) : (
        <AtSign size={large ? 24 : 17} />
      )}
    </span>
  );
}
