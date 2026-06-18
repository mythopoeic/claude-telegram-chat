/**
 * Minimal counting semaphore. Bounds how many turns run at once across topics,
 * so a burst of concurrent projects doesn't thrash the machine. Waiters are
 * served FIFO; a released permit is handed directly to the next waiter.
 */
export class Semaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(1, permits);
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next(); // hand the permit straight to the next waiter
    else this.permits++;
  }
}
