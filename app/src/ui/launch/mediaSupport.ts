import Guacamole from '../../vendor/guacamole-common-js/index.js';
import type { MediaSupport } from './connectData.ts';

/**
 * Supported media types, detected the way the 1.6.0 web client does
 * (`guacAudio.js`, `guacVideo.js`, `guacImage.js`): audio and video from the library, and
 * each image type kept only if this WebView decodes a test image.
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

export function currentMediaSupport(): MediaSupport {
  let audio: string[];
  let video: string[];
  try {
    audio = Guacamole.AudioPlayer.getSupportedTypes();
  } catch {
    audio = [];
  }
  try {
    video = Guacamole.VideoPlayer.getSupportedTypes();
  } catch {
    video = [];
  }
  return { audio, video, image: imageTypes };
}
