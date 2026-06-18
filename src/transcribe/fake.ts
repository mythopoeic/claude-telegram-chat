import type { Transcriber } from "./types.js";

/** In-memory transcriber for tests; returns a scripted string and records calls. */
export class FakeTranscriber implements Transcriber {
  readonly calls: { bytes: number; mime: string }[] = [];
  /** When set, transcribe() rejects with this error instead of returning text. */
  failWith: Error | null = null;

  constructor(private text = "transcribed text") {}

  /** Set what the next transcribe() returns. */
  setText(text: string): void {
    this.text = text;
  }

  async transcribe(audio: Uint8Array, mime: string): Promise<string> {
    this.calls.push({ bytes: audio.length, mime });
    if (this.failWith) throw this.failWith;
    return this.text;
  }
}
