export function sanitizeChannelName(topic: string, sessionIdPrefix: string): string {
  const sanitized = topic
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const base = sanitized || 'session';
  const name = `${base}-${sessionIdPrefix}`;
  return name.slice(0, 100);
}
