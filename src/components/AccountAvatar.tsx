import { useEffect, useState } from "react";
import { AtSign } from "lucide-react";
import { accountOrigin, useAccountProfileState } from "../lib/account";
import { native } from "../lib/native";

export default function AccountAvatar({ large = false }: { large?: boolean }) {
  const { profile, avatarVersion } = useAccountProfileState();
  const [origin, setOrigin] = useState("");
  const [failedImage, setFailedImage] = useState("");
  useEffect(() => {
    if (native) void accountOrigin().then(setOrigin);
  }, []);
  const image =
    profile?.avatar && profile.id && origin
      ? origin +
        "/api/avatar/" +
        encodeURIComponent(profile.id) +
        "?v=" +
        avatarVersion
      : "";
  return (
    <span
      className={
        large ? "account-avatar account-avatar-large" : "account-avatar"
      }
      aria-hidden="true"
    >
      {image && image !== failedImage ? (
        <img alt="" src={image} onError={() => setFailedImage(image)} />
      ) : (
        <AtSign size={large ? 24 : 17} />
      )}
    </span>
  );
}
