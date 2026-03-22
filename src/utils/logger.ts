type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_ORDER));
const rawLevel = process.env['LOG_LEVEL'] ?? 'info';
const minLevel: LogLevel = VALID_LEVELS.has(rawLevel) ? (rawLevel as LogLevel) : 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function format(level: LogLevel, message: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const extra = args.length > 0 ? ' ' + args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
    if (typeof a === 'string') return a;
    return JSON.stringify(a);
  }).join(' ') : '';
  return `${timestamp} [${level.toUpperCase()}] ${message}${extra}`;
}

export const logger = {
  debug(message: string, ...args: unknown[]) {
    if (shouldLog('debug')) console.debug(format('debug', message, ...args));
  },
  info(message: string, ...args: unknown[]) {
    if (shouldLog('info')) console.log(format('info', message, ...args));
  },
  warn(message: string, ...args: unknown[]) {
    if (shouldLog('warn')) console.warn(format('warn', message, ...args));
  },
  error(message: string, ...args: unknown[]) {
    if (shouldLog('error')) console.error(format('error', message, ...args));
  },
};
