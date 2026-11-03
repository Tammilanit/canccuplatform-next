/** Structured JSON logging on stdout. */
import { pino, type DestinationStream, type Logger } from "pino";
import { getCorrelationId } from "./context.js";

export type { Logger } from "pino";

/** JSON lines: time, level, module, message, correlation_id (when known), extra fields. */
export function createLogger(module: string, destination?: DestinationStream): Logger {
  const options = {
    messageKey: "message",
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { module },
    formatters: { level: (label: string) => ({ level: label }) },
    mixin: () => {
      const id = getCorrelationId();
      return id === undefined ? {} : { correlation_id: id };
    },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

export function utcNowIso(): string {
  return new Date().toISOString();
}
