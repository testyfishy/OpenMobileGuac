/**
 * Image types this WebView decodes, detected the way the 1.6.0 web client does
 * (`guacImage.js`). Kept apart from `mediaSupport.ts` so start-up does not load the
 * Guacamole library (code splitting).
 */

/** 1×1 test images (`guacImage.js` uses the same idea). */
const TEST_IMAGES: Readonly<Record<string, string>> = {
  'image/jpeg':
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'image/png':
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'image/webp': 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
};

/** Before detection finishes, assume what every WebView decodes. */
let imageTypes: readonly string[] = ['image/jpeg', 'image/png'];
let detection: Promise<readonly string[]> | undefined;

function decodes(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width === 1 && img.height === 1);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

/** Starts image-type detection once (call at startup). */
export function detectImageMimetypes(): Promise<readonly string[]> {
  if (!detection) {
    detection = (async () => {
      if (typeof Image === 'undefined') return imageTypes;
      const results = await Promise.all(
        Object.entries(TEST_IMAGES).map(async ([type, src]) =>
          (await decodes(src)) ? type : null,
        ),
      );
      const found = results.filter((t): t is string => t !== null);
      if (found.length > 0) imageTypes = found;
      return imageTypes;
    })();
  }
  return detection;
}

/** The detected (or assumed) image types. */
export function supportedImageTypes(): readonly string[] {
  return imageTypes;
}
