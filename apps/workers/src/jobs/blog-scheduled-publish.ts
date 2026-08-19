import cron from "node-cron";
import { prisma } from "@repo/database";

/**
 * Flips SCHEDULED blogs whose scheduledAt has arrived over to PUBLISHED, and
 * writes a BlogAuditLog row for each.
 *
 * BlogAuditLog.performedById is required (references User) and there is no
 * "system" user seeded in this schema, so the audit entry is attributed to
 * whoever approved/scheduled the post (reviewedById) - falling back to the
 * post's author if that's ever missing. This keeps every audit row pointing
 * at a real user without requiring a schema change.
 */
async function publishScheduledBlogs() {
  try {
    const now = new Date();

    const dueBlogs = await prisma.blog.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { lte: now },
        deletedAt: null,
      },
      select: {
        id: true,
        scheduledAt: true,
        reviewedById: true,
        authorId: true,
      },
    });

    for (const blog of dueBlogs) {
      const performedById = blog.reviewedById ?? blog.authorId;

      await prisma.$transaction(async (tx) => {
        await tx.blog.update({
          where: { id: blog.id },
          data: {
            status: "PUBLISHED",
            publishedById: performedById,
            publishedAt: blog.scheduledAt ?? now,
          },
        });

        await tx.blogAuditLog.create({
          data: {
            blogId: blog.id,
            performedById,
            action: "PUBLISHED",
            oldStatus: "SCHEDULED",
            newStatus: "PUBLISHED",
            metadata: { trigger: "scheduled-publish-cron" },
          },
        });
      });
    }

    if (dueBlogs.length > 0) {
      console.log(
        `[blog-scheduled-publish] published ${dueBlogs.length} blog(s)`,
      );
    }
  } catch (err) {
    console.error("[blog-scheduled-publish] failed:", err);
  }
}

// every 5 minutes
export function startBlogScheduledPublishJob() {
  cron.schedule("*/5 * * * *", publishScheduledBlogs, {
    timezone: "Asia/Kolkata",
  });
  console.log("[blog-scheduled-publish] job scheduled - every 5 minutes");
}
