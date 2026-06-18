/**
 * The Transcriber seam: turns a voice note's audio bytes into text so a
 * spoken message can drive a turn just like a typed one. Kept behind an
 * interface so the router is tested against a fake and never touches the
 * network or a real speech-to-text provider.
 */
export interface Transcriber {
  /**
   * Transcribe audio bytes to text. `mime` is the source content type (e.g.
   * "audio/ogg" for a Telegram voice note) so the backend can label the upload.
   * Throws on a provider/network error; returns "" when no speech was found.
   */
  transcribe(audio: Uint8Array, mime: string): Promise<string>;
}
