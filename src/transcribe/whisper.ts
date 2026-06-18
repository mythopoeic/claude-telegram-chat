import type { TranscriptionConfig } from "../config.js";
import type { Transcriber } from "./types.js";

/**
 * Transcriber backed by an OpenAI-compatible `/audio/transcriptions` endpoint.
 * Groq (whisper-large-v3-turbo) and OpenAI (whisper-1) expose the identical
 * multipart API, so the same client serves both — point `baseUrl`/`model` at
 * whichever provider's key is in config. Uses the global fetch/FormData/Blob
 * (Node 18+), so it needs no HTTP dependency.
 */
export class WhisperTranscriber implements Transcriber {
  constructor(private readonly cfg: TranscriptionConfig) {}

  async transcribe(audio: Uint8Array, mime: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: mime }), `voice.${extFor(mime)}`);
    form.append("model", this.cfg.model);
    form.append("response_format", "text");

    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`speech-to-text ${res.status}: ${detail.slice(0, 200)}`);
    }
    // response_format=text returns the transcript as the raw body.
    return (await res.text()).trim();
  }
}

/** A file extension the STT API recognizes, derived from the MIME type. */
function extFor(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  return "ogg"; // Telegram voice notes are OGG/Opus by default
}
