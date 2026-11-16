import type { SVGProps } from "react";
export default function Mark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      <path
        d="M32 12v40M14.7 22l34.6 20M14.7 42l34.6-20"
        stroke="currentColor"
        strokeWidth="8"
      />
    </svg>
  );
}
export function dragImage(dark: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const c = canvas.getContext("2d")!;
  c.scale(2, 2);
  c.strokeStyle = dark ? "#f2f4f1" : "#242a26";
  c.lineWidth = 8;
  c.beginPath();
  c.moveTo(32, 12);
  c.lineTo(32, 52);
  c.moveTo(14.7, 22);
  c.lineTo(49.3, 42);
  c.moveTo(14.7, 42);
  c.lineTo(49.3, 22);
  c.stroke();
  return canvas.toDataURL("image/png");
}
