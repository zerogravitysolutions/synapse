export interface ActionLogEntry {
  toolName: string;
  description: string;
  purpose?: string;
  timestamp: number;
}

export interface SessionActivity {
  description: string;
  purpose?: string;
  goal?: string;
  toolName?: string;
  startedAt: number;
  toolCounts: Record<string, number>;
  completedSteps: string[];
  usedSkills: string[];
  actionLog: ActionLogEntry[];
}

export class ActivityTracker {
  private activities = new Map<string, SessionActivity>();

  update(sessionId: string, description: string, toolName?: string, purpose?: string): void {
    const existing = this.activities.get(sessionId);
    if (existing) {
      // When purpose changes, save the previous one as a completed step
      if (purpose && existing.purpose && purpose !== existing.purpose) {
        this.addCompletedStep(existing, existing.purpose);
      }
      existing.description = description;
      existing.toolName = toolName;
      if (purpose) existing.purpose = purpose;
    } else {
      this.activities.set(sessionId, {
        description, toolName, purpose,
        startedAt: Date.now(),
        toolCounts: {},
        completedSteps: [],
        usedSkills: [],
        actionLog: [],
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

  /** Log a tool action with its description for the full activity summary. */
  logAction(sessionId: string, toolName: string, description: string, purpose?: string): void {
    const existing = this.activities.get(sessionId);
    if (!existing) return;

    existing.actionLog.push({
      toolName,
      description,
      purpose,
      timestamp: Date.now(),
    });

    // Cap at 50 entries to prevent unbounded growth
    if (existing.actionLog.length > 50) {
      existing.actionLog = existing.actionLog.slice(-50);
    }
  }

  addSkill(sessionId: string, skillName: string): void {
    const existing = this.activities.get(sessionId);
    if (existing && !existing.usedSkills.includes(skillName)) {
      existing.usedSkills.push(skillName);
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

  private addCompletedStep(activity: SessionActivity, step: string): void {
    // Avoid duplicates and near-duplicates
    const normalized = step.toLowerCase().trim();
    if (activity.completedSteps.some(s => s.toLowerCase().trim() === normalized)) return;

    activity.completedSteps.push(step);

    // Keep only the last 8 steps to prevent unbounded growth
    if (activity.completedSteps.length > 8) {
      activity.completedSteps = activity.completedSteps.slice(-8);
    }
  }
}
