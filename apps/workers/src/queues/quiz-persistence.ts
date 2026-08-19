import { Worker } from "bullmq";
import { bullmqConnection, REDIS_PREFIX } from "../lib/redis";
import { prisma } from "@repo/database";
import { redisCache } from "../lib/redis";

export function startQuizPersistenceWorker() {
  const worker = new Worker(
    "quiz-persistence",
    async (job) => {
      const {
        id,
        attemptNumber,
        userId,
        quizId,
        submittedAt,
        answers,
        score,
        maxScore,
        percentage,
        accuracy,
        correctCount,
        wrongCount,
        skippedCount,
      } = job.data;
      const timeTakenSeconds = 0;

      // Because BullMQ provides at-least-once delivery, we must handle duplicate jobs safely.
      // The route fixes `id` and `attemptNumber` before enqueueing, so a
      // redelivered job always retries with the same values and hits the
      // same P2002 guard below (now keyed on the PK instead of the old
      // (userId, quizId) unique constraint, since reattempts are allowed).

      try {
        await prisma.$transaction(async (tx) => {
          // 1. Work out whether this attempt is the user's new best BEFORE
          // inserting, using the same tie-break order as the leaderboard job
          // (score desc, timeTakenSeconds asc, earlier submission wins ties).
          const currentBest = await tx.userQuizSubmission.findFirst({
            where: { userId, quizId, isBestAttempt: true },
          });
          const isBestAttempt =
            !currentBest ||
            score > currentBest.score ||
            (score === currentBest.score &&
              currentBest.timeTakenSeconds != null &&
              timeTakenSeconds < currentBest.timeTakenSeconds);

          // 2. Persist the submission (Rely on Database Unique Constraint for Idempotency)
          let submission;
          try {
            submission = await tx.userQuizSubmission.create({
              data: {
                id,
                attemptNumber,
                isBestAttempt,
                userId,
                quizId,
                submittedAt: new Date(submittedAt),
                answers,
                score,
                maxScore,
                percentage,
                accuracy,
                correctCount,
                wrongCount,
                skippedCount,
                timeTakenSeconds,
              },
            });
          } catch (e: any) {
            // Prisma error code P2002 means Unique constraint failed
            if (e.code === "P2002") {
              console.log(
                `[quiz-persistence] Duplicate job ignored for User: ${userId}, Quiz: ${quizId}`,
              );
              return; // Idempotent exit, do NOT update stats.
            }
            throw e; // Bubble up other errors
          }

          if (isBestAttempt && currentBest) {
            await tx.userQuizSubmission.update({
              where: { id: currentBest.id },
              data: { isBestAttempt: false },
            });
          }

          // 3. Update user stats (Only reached if the above CREATE succeeded)
          await tx.userQuizStats.upsert({
            where: { userId },
            create: {
              userId,
              quizzesAttempted: 1,
              totalScore: score,
              totalCorrect: correctCount,
              totalWrong: wrongCount,
              totalSkipped: skippedCount,
            },
            update: {
              quizzesAttempted: { increment: 1 },
              totalScore: { increment: score },
              totalCorrect: { increment: correctCount },
              totalWrong: { increment: wrongCount },
              totalSkipped: { increment: skippedCount },
            },
          });
        });

        // 4. Set Redis Submission Marker upon successful commit
        const markerKey = `quiz_submitted:${userId}:${quizId}`;
        await redisCache.set(markerKey, "1", "EX", 86400 * 7); // 7 days TTL
      } catch (err: any) {
        throw err;
      }
    },
    { connection: bullmqConnection, prefix: REDIS_PREFIX },
  );

  worker.on("completed", (job) => {
    console.log(
      `[quiz-persistence] Job ${job.id} completed (User: ${job.data.userId}, Quiz: ${job.data.quizId})`,
    );
  });

  worker.on("failed", (job, err) => {
    console.error(`[quiz-persistence] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
