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

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex } from "../../lib/color";
import { Pipette } from "lucide-react";
function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
}
export default function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const channels = rgb(value);
  const previousHue = useRef(0);
  const [rawHue, saturation, brightness] = hexToHsv(value);
  const hue = saturation ? rawHue : previousHue.current;
  function choose(h: number, s: number, v: number) {
    previousHue.current = (h + 360) % 360;
    onChange(
      hsvToHex(
        previousHue.current,
        Math.max(0, Math.min(1, s)),
        Math.max(0, Math.min(1, v)),
      ),
    );
  }
  function point(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    choose(
      ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
      Math.min(1, Math.hypot(x, y) / (bounds.width / 2)),
      brightness,
    );
  }
  return (
    <Popover.Root>
      <Popover.Trigger
        className="custom-accent devyy-color-trigger"
        aria-label="Custom accent color"
        title="Custom accent color"
        style={{ background: value }}
      >
        <Pipette size={13} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="devyy-color-popup"
          sideOffset={8}
          collisionPadding={12}
          data-escape-scope="active"
          aria-label="Custom accent color"
        >
          <strong>Custom accent</strong>
          <div
            className="devyy-color-wheel"
            role="slider"
            tabIndex={0}
            aria-label="Hue and saturation"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hue)}
            aria-valuetext={`${Math.round(hue)} degrees, ${Math.round(saturation * 100)}% saturation`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              point(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                point(event);
            }}
            onKeyDown={(event) => {
              if (
                ![
                  "ArrowLeft",
                  "ArrowRight",
                  "ArrowUp",
                  "ArrowDown",
                  "Home",
                  "End",
                ].includes(event.key)
              )
                return;
              event.preventDefault();
              if (event.key === "Home" || event.key === "End")
                choose(hue, event.key === "Home" ? 0 : 1, brightness);
              else if (event.key === "ArrowUp" || event.key === "ArrowDown")
                choose(
                  hue,
                  saturation + (event.key === "ArrowUp" ? 0.02 : -0.02),
                  brightness,
                );
              else
                choose(
                  hue + (event.key === "ArrowRight" ? 2 : -2),
                  saturation,
                  brightness,
                );
            }}
          >
            <span
              className="devyy-color-wheel-shade"
              style={{ opacity: 1 - brightness }}
            />
            <span
              className="devyy-color-handle"
              style={{
                left: `${50 + Math.cos((hue * Math.PI) / 180) * saturation * 50}%`,
                top: `${50 + Math.sin((hue * Math.PI) / 180) * saturation * 50}%`,
                background: value,
              }}
            />
          </div>
          <label className="devyy-color-brightness">
            Brightness
            <input
              type="range"
              aria-label="Color brightness"
              min={0}
              max={100}
              value={Math.round(brightness * 100)}
              style={{
                background: `linear-gradient(to right, #000, ${hsvToHex(hue, saturation, 1)})`,
              }}
              onChange={(event) =>
                choose(hue, saturation, Number(event.target.value) / 100)
              }
            />
          </label>
          <div className="devyy-color-preview" style={{ background: value }} />
          <label>
            Hex
            <input
              aria-label="Accent hex value"
              spellCheck={false}
              value={text}
              onChange={(event) => {
                const next = event.target.value;
                setText(next);
                if (/^#[\da-f]{6}$/i.test(next)) onChange(next);
              }}
              onBlur={() => setText(value)}
            />
          </label>
          {(["Red", "Green", "Blue"] as const).map((label, index) => (
            <label key={label} className="devyy-color-channel">
              {label}
              <input
                type="range"
                aria-label={`${label} channel`}
                min={0}
                max={255}
                value={channels[index]}
                onChange={(event) => {
                  const next = [...channels];
                  next[index] = Number(event.target.value);
                  onChange(
                    "#" +
                      next
                        .map((channel) => channel.toString(16).padStart(2, "0"))
                        .join(""),
                  );
                }}
              />
              <output>{channels[index]}</output>
            </label>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
