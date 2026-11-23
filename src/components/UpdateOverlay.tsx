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

import { useEffect, useRef } from "react";
import { Asterisk } from "lucide-react";

export default function UpdateOverlay() {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="update-overlay"
      aria-label="Opening the Devyy release page"
      onCancel={(event) => event.preventDefault()}
    >
      <Asterisk size={72} strokeWidth={1.8} aria-hidden="true" />
      <div
        className="update-progress"
        role="progressbar"
        aria-label="Opening release"
      />
    </dialog>
  );
}
