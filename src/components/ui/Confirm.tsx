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

import { ModalSurface, ModalActions } from "./ModalSurface";
import * as Alert from "@radix-ui/react-alert-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
export interface Confirmation {
  title?: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  rememberLabel?: string;
  onRemember?: () => void;
}
type Request = Confirmation & { resolve: (value: boolean) => void };
const Context = createContext<(options: Confirmation) => Promise<boolean>>(() =>
  Promise.resolve(false),
);
export const useConfirm = () => useContext(Context);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [remember, setRemember] = useState(false);
  const [queue, setQueue] = useState<Request[]>([]);
  const requests = useRef<Request[]>([]);
  const confirm = useCallback(
    (options: Confirmation) =>
      new Promise<boolean>((resolve) => {
        const next = { ...options, resolve };
        requests.current.push(next);
        setQueue([...requests.current]);
      }),
    [],
  );
  const finish = (value: boolean) => {
    const request = requests.current.shift();
    if (value && remember) request?.onRemember?.();
    request?.resolve(value);
    setRemember(false);
    setQueue([...requests.current]);
  };
  useEffect(
    () => () => {
      requests.current.splice(0).forEach((request) => request.resolve(false));
    },
    [],
  );
  const last = useRef<Request | undefined>(undefined);
  if (queue[0]) last.current = queue[0];
  const current = queue[0] ?? last.current;
  return (
    <Context.Provider value={confirm}>
      {children}
      <Alert.Root
        open={queue.length > 0}
        onOpenChange={(open) => {
          if (!open && requests.current.length) finish(false);
        }}
      >
        <Alert.Portal>
          <Alert.Overlay className="devyy-dialog-overlay" />
          <Alert.Content asChild>
            <ModalSurface className="devyy-confirm" data-escape-scope="active">
              <span
                className={`devyy-dialog-symbol ${current?.danger ? "danger" : ""}`}
              >
                <AlertTriangle size={21} />
              </span>
              <Alert.Title>{current?.title ?? "Confirm action"}</Alert.Title>
              <Alert.Description>{current?.description}</Alert.Description>
              {current?.rememberLabel && (
                <label className="confirm-remember">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  {current.rememberLabel}
                </label>
              )}
              <ModalActions>
                <Alert.Cancel
                  className="devyy-button"
                  onClick={(event) => {
                    event.preventDefault();
                    finish(false);
                  }}
                >
                  Cancel
                </Alert.Cancel>
                <Alert.Action
                  className={`devyy-button ${current?.danger ? "danger" : "primary"}`}
                  onClick={(event) => {
                    event.preventDefault();
                    finish(true);
                  }}
                >
                  {current?.confirmLabel ?? "Continue"}
                </Alert.Action>
              </ModalActions>
            </ModalSurface>
          </Alert.Content>
        </Alert.Portal>
      </Alert.Root>
    </Context.Provider>
  );
}
