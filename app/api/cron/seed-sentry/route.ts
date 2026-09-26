import { handleSeedCron } from "@/lib/sentry/seed-cron";

export function GET(request: Request) {
  return handleSeedCron(request, process.env);
}
