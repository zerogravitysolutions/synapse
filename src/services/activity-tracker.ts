export interface SessionActivity {
  description: string;
  purpose?: string;
  goal?: string;
  toolName?: string;
  startedAt: number;
  toolCounts: Record<string, number>;
}

export class ActivityTracker {
  private activities = new Map<string, SessionActivity>();

  update(sessionId: string, description: string, toolName?: string, purpose?: string): void {
    const existing = this.activities.get(sessionId);
    if (existing) {
      existing.description = description;
      existing.toolName = toolName;
      if (purpose) existing.purpose = purpose;
    } else {
      this.activities.set(sessionId, {
        description, toolName, purpose,
        startedAt: Date.now(),
        toolCounts: {},
      });
    }
  }

  /** Count a completed tool invocation. */
  countTool(sessionId: string, toolName: string): void {
    const existing = this.activities.get(sessionId);
    if (existing) {
      existing.toolCounts[toolName] = (existing.toolCounts[toolName] ?? 0) + 1;
    }
  }

  setGoal(sessionId: string, goal: string): void {
    const existing = this.activities.get(sessionId);
    if (existing && !existing.goal) {
      existing.goal = goal;
    }
  }

  get(sessionId: string): SessionActivity | undefined {
    return this.activities.get(sessionId);
  }

  clear(sessionId: string): void {
    this.activities.delete(sessionId);
  }

  isActive(sessionId: string): boolean {
    return this.activities.has(sessionId);
  }
}
