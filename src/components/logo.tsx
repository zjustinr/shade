/**
 * The Cool Corners mark: a Chinatown-gate roofline, the sun that makes the
 * shade, and the shade it throws. Same drawing as brand/logo-mark.svg (the
 * source for every icon, see scripts/build-icons.mjs), without the cream
 * background tile so it sits on the page. Change one, change both.
 *
 * Decorative: the site name beside it is the accessible label.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="48 48 414 406"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="98" cy="98" r="48" fill="#F59E0B" />
      <path d="M122 384 L318 384 L458 450 L262 450 Z" fill="#3F6C8C" />
      <g fill="#1F2A44">
        <path d="M156 152 C178 152 184 126 206 114 L234 114 C256 126 262 152 284 152 L284 162 L156 162 Z" />
        <path d="M96 204 C140 204 150 172 184 160 L256 160 C290 172 300 204 344 204 L344 222 L96 222 Z" />
        <rect x="122" y="222" width="30" height="162" />
        <rect x="288" y="222" width="30" height="162" />
        <rect x="152" y="244" width="136" height="24" />
      </g>
    </svg>
  );
}
