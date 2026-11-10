import { useState } from "react";

export default function ProjectBadge({
  name,
  logo,
}: {
  name: string;
  logo?: string | null;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showLogo = !!logo && failed !== logo;
  return (
    <span className={`project-monogram ${showLogo ? "has-logo" : ""}`}>
      {showLogo ? (
        <img
          src={logo}
          alt={`${name} logo`}
          onError={() => setFailed(logo)}
          draggable={false}
        />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
