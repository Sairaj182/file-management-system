import cron from "node-cron";
import { prisma } from "@repo/database";
import { redisCache } from "../lib/redis";

export async function calculateLeaderboards() {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);

    // Fetch all quizzes from the last 7 days that are LIVE or ENDED
    const activeQuizzes = await prisma.quiz.findMany({
      where: {
        quizDate: {
          gte: sevenDaysAgo,
        },
        status: { in: ["LIVE", "ENDED"] },
      },
      select: { id: true },
    });

    console.log(
      `[leaderboard] Found ${activeQuizzes.length} active quizzes for leaderboard calculation.`,
    );

    for (const quiz of activeQuizzes) {
      // isBestAttempt: true - with reattempts allowed, only each student's
      // best-scoring attempt counts toward the leaderboard.
      const topSubmissions = await prisma.userQuizSubmission.findMany({
        where: { quizId: quiz.id, isBestAttempt: true },
        orderBy: [
          { score: "desc" },
          { timeTakenSeconds: "asc" },
          { submittedAt: "asc" }, // Tie breaker
        ],
        take: 100, // Top 100
        select: {
          score: true,
          accuracy: true,
          timeTakenSeconds: true,
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      });

      const redisKey = `quiz_leaderboard:${quiz.id}`;
      const payload = {
        updatedAt: now.toISOString(),
        entries: topSubmissions,
      };
      // Store in Redis (1 day TTL so it clears out naturally if no longer updated)
      await redisCache.set(redisKey, JSON.stringify(payload), "EX", 86400);

      console.log(
        `[leaderboard] Updated quiz ${quiz.id} with ${topSubmissions.length} top users.`,
      );
    }
  } catch (err) {
    console.error("[leaderboard] calculation failed:", err);
  }
}

// Run every hour
export function startLeaderboardJob() {
  cron.schedule("0 * * * *", calculateLeaderboards, {
    timezone: "Asia/Kolkata",
  });
  console.log("[leaderboard] job scheduled - every 1 hour");
}
