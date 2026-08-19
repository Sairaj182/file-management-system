import { env } from "./env";
import { startLeaderboardJob } from "./jobs/leaderboard";
import { startBlogScheduledPublishJob } from "./jobs/blog-scheduled-publish";
import { startBlogAnalyticsRollupJob } from "./jobs/blog-analytics-rollup";
import { startEmailWorker } from "./queues/email";
import { startWhatsAppWorker } from "./queues/whatsapp";
import { startQuizPersistenceWorker } from "./queues/quiz-persistence";

console.log(`[workers] starting in ${env.NODE_ENV} mode`);

// cron jobs
startLeaderboardJob();
startBlogScheduledPublishJob();
startBlogAnalyticsRollupJob();

// queue workers
startEmailWorker();
startWhatsAppWorker();
startQuizPersistenceWorker();

console.log("[workers] all jobs and workers running");

// keep process alive
process.on("SIGTERM", () => {
  console.log("[workers] shutting down");
  process.exit(0);
});
