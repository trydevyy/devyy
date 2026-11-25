const pageLocation = globalThis.location;
const params = new URLSearchParams(pageLocation?.search);
export const embeddedThemePreview =
  typeof window !== "undefined" &&
  window.parent !== window &&
  params.get("showcase") === "theme" &&
  params.get("playground") === "1";

// The bundled desktop page can have a custom protocol with an opaque origin.
const webOrigin =
  pageLocation?.protocol === "http:" || pageLocation?.protocol === "https:";
export const previewTargetOrigin = webOrigin ? pageLocation.origin : "*";
export function matchesPreviewOrigin(origin: string) {
  return origin === pageLocation?.origin || (!webOrigin && origin === "null");
}
