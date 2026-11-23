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

import React from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ContextMenuProvider } from "./components/ContextMenu";
import { ConfirmProvider } from "./components/ui/Confirm";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "./styles.css";
function reportCrash(kind: "error" | "rejection", line = 0) {
  if (isTauri()) {
    void invoke("report_frontend_crash", { kind, line }).catch(() => {});
  }
}

window.addEventListener("error", (event) => reportCrash("error", event.lineno));
window.addEventListener("unhandledrejection", () => reportCrash("rejection"));

ReactDOM.createRoot(document.getElementById("root")!, {
  onUncaughtError(error, info) {
    console.error(error, info);
    reportCrash("error");
  },
}).render(
  <React.StrictMode>
    <ContextMenuProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ContextMenuProvider>
  </React.StrictMode>,
);
