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

import { useId, useState, type InputHTMLAttributes } from "react";
export default function SuggestionInput({
  suggestions,
  onChange,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  suggestions: { id: string; name: string }[];
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState(0);
  const query = String(props.value ?? "").toLowerCase();
  const options = suggestions
    .filter((item) => `${item.id} ${item.name}`.toLowerCase().includes(query))
    .slice(0, 12);
  return (
    <div
      className="devyy-suggestion-input"
      data-escape-scope={open ? "active" : undefined}
    >
      <input
        {...props}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={open ? id : undefined}
        aria-activedescendant={
          open && options[selected] ? `${id}-${selected}` : undefined
        }
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setOpen(true);
          setSelected(0);
          onChange?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
          if (open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setSelected((old) =>
              Math.max(
                0,
                Math.min(
                  options.length - 1,
                  old + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (event.key === "Enter" && open && options[selected]) {
            event.preventDefault();
            const input = event.currentTarget;
            input.value = options[selected].id;
            onChange?.({
              target: input,
              currentTarget: input,
            } as React.ChangeEvent<HTMLInputElement>);
            setOpen(false);
          }
        }}
      />
      {open && !!options.length && (
        <div
          role="listbox"
          id={id}
          className="devyy-suggestions"
          aria-label="Model suggestions"
          data-escape-scope="active"
        >
          {options.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={selected === index}
              id={`${id}-${index}`}
              key={item.id}
              tabIndex={-1}
              onMouseDown={(event) => {
                event.preventDefault();
                const input = event.currentTarget.parentElement
                  ?.previousElementSibling as HTMLInputElement;
                input.value = item.id;
                onChange?.({
                  target: input,
                  currentTarget: input,
                } as React.ChangeEvent<HTMLInputElement>);
                setOpen(false);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
