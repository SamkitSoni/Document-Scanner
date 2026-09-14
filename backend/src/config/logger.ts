import pino from 'pino';
import { env, isProduction, isTest } from './env.js';

/**
 * Structured JSON logging. Redaction is a second line of defence — extracted
 * field values and client metadata must never reach the logs, since they carry
 * document contents. Call sites log field *names* and rule identifiers instead.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'extractedData',
      'metadata',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.extractedData',
      '*.metadata',
    ],
    censor: '[redacted]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }),
});

/** Logger bound to one document, so every line carries its id automatically. */
export function documentLogger(documentId: string) {
  return logger.child({ documentId });
}
