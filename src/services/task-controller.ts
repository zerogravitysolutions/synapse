/** Manages abort controllers for in-flight CLI processes, shared between MessageHandler and /stop. */
export class TaskController {
  private controllers = new Map<string, AbortController>();
  private gracefulStops = new Set<string>();
  private pendingInjects = new Map<string, string>();

  create(sessionId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    return controller;
  }

  /** Immediate abort — kills the process now. */
  abort(sessionId: string): boolean {
    const controller = this.controllers.get(sessionId);
    if (!controller) return false;
    controller.abort();
    this.controllers.delete(sessionId);
    this.gracefulStops.delete(sessionId);
    return true;
  }

  /** Graceful stop — waits for the current tool to finish, then kills. */
  requestGracefulStop(sessionId: string): boolean {
    if (!this.controllers.has(sessionId)) return false;
    this.gracefulStops.add(sessionId);
    return true;
  }

  /** Check and execute pending graceful stop. Returns true if aborted. */
  checkGracefulStop(sessionId: string): boolean {
    if (!this.gracefulStops.has(sessionId)) return false;
    return this.abort(sessionId);
  }

  /** Queue an inject message — stops gracefully at next tool boundary, then sends inject. */
  requestInject(sessionId: string, message: string): boolean {
    if (!this.controllers.has(sessionId)) return false;
    this.pendingInjects.set(sessionId, message);
    this.gracefulStops.add(sessionId);
    return true;
  }

  /** Consume the pending inject message (if any) — returns it and clears it. */
  consumeInject(sessionId: string): string | undefined {
    const msg = this.pendingInjects.get(sessionId);
    this.pendingInjects.delete(sessionId);
    return msg;
  }

  hasPendingInject(sessionId: string): boolean {
    return this.pendingInjects.has(sessionId);
  }

  remove(sessionId: string): void {
    this.controllers.delete(sessionId);
    this.gracefulStops.delete(sessionId);
    this.pendingInjects.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.controllers.has(sessionId);
  }

  isGracefulStopPending(sessionId: string): boolean {
    return this.gracefulStops.has(sessionId);
  }
}
