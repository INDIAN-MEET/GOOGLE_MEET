import "dotenv/config";
import Joi from "joi";

/**
 * Joi schema describing every environment variable this service needs.
 * Required values have no default, so a missing one aborts startup.
 */
const schema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().port().default(4008),

  JWT_ACCESS_SECRET: Joi.string().min(8).required(),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),
  ROOM_SERVICE_URL: Joi.string().uri().required(),

  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().required(),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow("").default(""),
  SMTP_PASS: Joi.string().allow("").default(""),
  MAIL_FROM: Joi.string().required(),

  FRONTEND_URL: Joi.string().uri().required(),
  REMINDER_OFFSETS_MIN: Joi.string().default("15,5"),

  EMAIL_QUEUE_CONCURRENCY: Joi.number().integer().min(1).default(5),
  EMAIL_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
}).unknown(true); // ignore unrelated variables such as PATH

const { value, error } = schema.validate(process.env, { abortEarly: false });

if (error) {
  // Print every problem at once so you can fix them in one go.
  throw new Error(`Invalid environment configuration: ${error.message}`);
}

/**
 * Parse "15,5" into [15, 5], sorted largest first, positive numbers only.
 *
 * @param raw Comma-separated minutes string from the environment.
 * @returns Array of minutes before the meeting at which to send reminders.
 */
function parseOffsets(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
}

/** Typed, validated configuration used everywhere else in the service. */
export const env = {
  nodeEnv: value.NODE_ENV as string,
  isProd: value.NODE_ENV === "production",
  port: value.PORT as number,

  jwtAccessSecret: value.JWT_ACCESS_SECRET as string,
  databaseUrl: value.DATABASE_URL as string,
  redisUrl: value.REDIS_URL as string,
  roomServiceUrl: value.ROOM_SERVICE_URL as string,

  smtp: {
    host: value.SMTP_HOST as string,
    port: value.SMTP_PORT as number,
    secure: value.SMTP_SECURE as boolean,
    user: value.SMTP_USER as string,
    pass: value.SMTP_PASS as string,
  },
  mailFrom: value.MAIL_FROM as string,

  frontendUrl: (value.FRONTEND_URL as string).replace(/\/$/, ""),
  reminderOffsetsMin: parseOffsets(value.REMINDER_OFFSETS_MIN as string),

  emailQueueConcurrency: value.EMAIL_QUEUE_CONCURRENCY as number,
  emailMaxAttempts: value.EMAIL_MAX_ATTEMPTS as number,
};