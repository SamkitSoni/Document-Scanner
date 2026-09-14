import { z } from 'zod';

/**
 * Environment is parsed once, at boot, and the process exits immediately if it
 * is invalid. Failing here is much cheaper than discovering a missing variable
 * halfway through processing a document.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),

  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  STORAGE_DRIVER: z.enum(['disk', 'postgres']).default('disk'),
  STORAGE_PATH: z.string().default('./uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  MAX_PROCESSING_ATTEMPTS: z.coerce.number().int().positive().default(3),
  MOCK_PROCESSOR_MODE: z
    .enum(['random', 'always_success', 'always_timeout', 'always_invalid'])
    .default('random'),
  MOCK_PROCESSOR_DELAY_MS: z.coerce.number().int().nonnegative().default(1500),

  RUN_WORKER_IN_PROCESS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  JOB_LEASE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Deliberately console.error: the logger itself depends on this config.
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
