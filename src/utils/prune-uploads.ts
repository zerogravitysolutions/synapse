import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from './logger.js';

/**
 * Prune Discord upload tempfiles older than `maxAgeMs` (default 24h).
 *
 * Discord attachments are downloaded to `${tmpdir()}/mindbridge-uploads/<channelId>/`
 * but never explicitly removed. On Windows the system tmpdir is rarely
 * auto-cleaned, so files accumulate forever; on Linux/macOS most tmpdirs
 * are wiped at boot but a long-running bot can still accumulate per-day
 * volume. This runs once at startup and silently skips errors.
 */
export async function pruneOldUploads(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> {
  const root = join(tmpdir(), 'mindbridge-uploads');
  const channels = await readdir(root).catch(() => [] as string[]);
  if (channels.length === 0) return;

  const now = Date.now();
  let pruned = 0;

  for (const ch of channels) {
    const dir = join(root, ch);
    const files = await readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      const fp = join(dir, f);
      const st = await stat(fp).catch(() => null);
      if (st && st.isFile() && now - st.mtimeMs > maxAgeMs) {
        await rm(fp, { force: true }).catch(() => {});
        pruned++;
      }
    }
  }

  if (pruned > 0) {
    logger.info(`Pruned ${pruned} old upload tempfile${pruned === 1 ? '' : 's'} from ${root}`);
  }
}
