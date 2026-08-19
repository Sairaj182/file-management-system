import cron from "node-cron";
import { prisma } from "@repo/database";

const PRUNE_AFTER_DAYS = 90;
// Recompute a small trailing window (not just "since last run") so late-arriving
// events and the still-in-progress current day both get folded in correctly.
const ROLLUP_WINDOW_DAYS = 3;

function truncateToUTCDate(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/**
 * Aggregates recent BlogEvent rows into BlogDailyStat (upsert per blogId+date,
 * truncated to UTC day). Recomputes the trailing ROLLUP_WINDOW_DAYS days on
 * every run rather than trying to track "new since last run" - simpler and
 * self-healing if a run is missed or events arrive late.
 */
export async function rollupBlogAnalytics() {
  try {
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setUTCDate(windowStart.getUTCDate() - ROLLUP_WINDOW_DAYS);
    windowStart.setUTCHours(0, 0, 0, 0);

    const affectedBlogs = await prisma.blogEvent.findMany({
      where: { createdAt: { gte: windowStart } },
      distinct: ["blogId"],
      select: { blogId: true },
    });

    let dailyStatsWritten = 0;

    for (const { blogId } of affectedBlogs) {
      const events = await prisma.blogEvent.findMany({
        where: { blogId, createdAt: { gte: windowStart } },
        select: { type: true, visitorId: true, value: true, createdAt: true },
      });

      const byDate = new Map<string, typeof events>();
      for (const ev of events) {
        const dateKey = truncateToUTCDate(ev.createdAt).toISOString();
        const bucket = byDate.get(dateKey);
        if (bucket) {
          bucket.push(ev);
        } else {
          byDate.set(dateKey, [ev]);
        }
      }

      for (const [dateKey, dayEvents] of byDate) {
        const date = new Date(dateKey);
        const views = dayEvents.filter((e) => e.type === "VIEW").length;
        const uniqueVisitors = new Set(dayEvents.map((e) => e.visitorId)).size;
        const completions = dayEvents.filter(
          (e) => e.type === "SCROLL_100",
        ).length;
        const promoClicks = dayEvents.filter(
          (e) => e.type === "PROMO_CLICK",
        ).length;

        const timeEvents = dayEvents.filter((e) => e.type === "TIME_ON_PAGE");
        const avgTimeOnPageSeconds =
          timeEvents.length > 0
            ? timeEvents.reduce((sum, e) => {
                const seconds = (e.value as any)?.seconds;
                return sum + (typeof seconds === "number" ? seconds : 0);
              }, 0) / timeEvents.length
            : 0;

        await prisma.blogDailyStat.upsert({
          where: { blogId_date: { blogId, date } },
          create: {
            blogId,
            date,
            views,
            uniqueVisitors,
            completions,
            avgTimeOnPageSeconds,
            promoClicks,
          },
          update: {
            views,
            uniqueVisitors,
            completions,
            avgTimeOnPageSeconds,
            promoClicks,
          },
        });
        dailyStatsWritten += 1;
      }
    }

    console.log(
      `[blog-analytics-rollup] rolled up ${dailyStatsWritten} blog/day row(s) across ${affectedBlogs.length} blog(s)`,
    );
  } catch (err) {
    console.error("[blog-analytics-rollup] rollup failed:", err);
  }
}

/** Raw event stream is high write volume and short-lived - BlogDailyStat is the permanent record. */
export async function pruneOldBlogEvents() {
  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - PRUNE_AFTER_DAYS);
    const result = await prisma.blogEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    console.log(
      `[blog-analytics-rollup] pruned ${result.count} blog event(s) older than ${PRUNE_AFTER_DAYS} days`,
    );
  } catch (err) {
    console.error("[blog-analytics-rollup] prune failed:", err);
  }
}

export function startBlogAnalyticsRollupJob() {
  // hourly at :05
  cron.schedule("5 * * * *", rollupBlogAnalytics, { timezone: "Asia/Kolkata" });
  // daily at 02:30 IST
  cron.schedule("30 2 * * *", pruneOldBlogEvents, { timezone: "Asia/Kolkata" });
  console.log(
    "[blog-analytics-rollup] jobs scheduled - hourly rollup, daily prune at 02:30 IST",
  );
}
