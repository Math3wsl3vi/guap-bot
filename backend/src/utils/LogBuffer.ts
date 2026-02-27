import Transport from 'winston-transport';

export interface BufferedLogEntry {
  id: string;
  timestamp: string;
  level: string;
  component: string;
  message: string;
}

const MAX_ENTRIES = 500;
let _seq = 0;
const _buffer: BufferedLogEntry[] = [];

/** Return a copy of the in-memory log buffer (most-recent last). */
export function getLogBuffer(): BufferedLogEntry[] {
  return [..._buffer];
}

/** Winston Transport that appends log entries to the in-memory circular buffer. */
export class LogBufferTransport extends Transport {
  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
  }

  log(info: Record<string, unknown>, callback: () => void): void {
    // Strip ANSI colour codes that the console transport may inject
    const rawLevel = String(info.level ?? 'info').replace(/\u001B\[[0-9;]*m/g, '');

    const entry: BufferedLogEntry = {
      id: String(++_seq),
      timestamp: String(info.timestamp ?? new Date().toISOString()),
      level: rawLevel.toUpperCase(),
      component: String(info.component ?? 'Bot'),
      message:
        typeof info.message === 'string'
          ? info.message
          : JSON.stringify(info.message),
    };

    _buffer.push(entry);
    if (_buffer.length > MAX_ENTRIES) {
      _buffer.shift();
    }

    this.emit('logged', info);
    callback();
  }
}
