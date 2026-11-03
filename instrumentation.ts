import * as Sentry from "@sentry/nextjs";

// Server-side (Node and edge) errors to Sentry. No-op without a DSN.
export function register() {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    tracesSampleRate: 0,
  });
}

export const onRequestError = Sentry.captureRequestError;
