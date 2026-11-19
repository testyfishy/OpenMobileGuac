import Guacamole from '../../vendor/guacamole-common-js/index.js';
import type { MediaSupport } from './connectData.ts';
import { supportedImageTypes } from './imageSupport.ts';

export { detectImageMimetypes } from './imageSupport.ts';

/**
 * Supported media types, detected the way the 1.6.0 web client does
 * (`guacAudio.js`, `guacVideo.js`, `guacImage.js`): audio and video from the library, and
 * images from imageSupport.ts.
 */

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
  return { audio, video, image: supportedImageTypes() };
}
