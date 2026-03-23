/** Manages abort controllers for in-flight CLI processes, shared between MessageHandler and /stop. */
export class TaskController {
  private controllers = new Map<string, AbortController>();

  create(sessionId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    return controller;
  }

  abort(sessionId: string): boolean {
    const controller = this.controllers.get(sessionId);
    if (!controller) return false;
    controller.abort();
    this.controllers.delete(sessionId);
    return true;
  }

  remove(sessionId: string): void {
    this.controllers.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.controllers.has(sessionId);
  }
}
