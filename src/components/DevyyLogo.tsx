export default function DevyyLogo({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="devyy-logo"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M32 12v40M14.7 22l34.6 20M14.7 42l34.6-20"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
      />
    </svg>
  );
}
