import { LOGO_PATH, LOGO_VIEWBOX } from "@/assets/logo-path";

/**
 * Demox wordmark as inline SVG: no network request, fixed box, so it is
 * visible on first paint (no blank header while an <img> downloads).
 * Keep in sync with src/assets/logo.svg (the same path is inlined into the
 * prerendered HTML by scripts/generate-seo-pages.mjs).
 */
export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox={LOGO_VIEWBOX}
      width="117"
      height="32"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={LOGO_PATH} fillRule="evenodd" />
    </svg>
  );
}
