// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
