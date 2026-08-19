import { Worker, Queue } from "bullmq";
import { prisma, type ApplicationStatus } from "@repo/database";
import { bullmqConnection, REDIS_PREFIX } from "../lib/redis";

const AISENSY_API_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

/**
 * Approved AiSensy template for career application status updates.
 * Body has 7 placeholders ({{1}}..{{7}}):
 *   Dear {{1}}, ... position of {{2}}. ... Applicant Name: {{3}} ...
 *   Position Applied: {{4}} ... Application ID: {{5}} ... Current Status: {{6}}
 *   {{7}} (the per-status message)
 * {{1}}/{{3}} and {{2}}/{{4}} are the same values repeated - the template
 * itself reuses name/job title at two positions, so all 7 must still be sent.
 */
const CAREER_STATUS_CAMPAIGN = "Mian_website_carrer_update_notifcation";

const CAREER_STATUS_LABEL: Record<ApplicationStatus, string> = {
  APPLIED: "Applied",
  UNDER_REVIEW: "Under Review",
  SHORTLISTED: "Shortlisted",
  INTERVIEW_SCHEDULED: "Interview Scheduled",
  OFFERED: "Offer Extended",
  HIRED: "Hired",
  REJECTED: "Not Selected",
};

function formatInterviewDateTimeIST(date: Date): string {
  const weekday = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
  }).format(date);
  const dateStr = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${weekday}, ${dateStr} at ${time} IST`;
}

function careerStatusMessage(application: {
  status: ApplicationStatus;
  interviewAt: Date | null;
  interviewMode: "ONLINE" | "OFFLINE" | null;
  interviewMeetingLink: string | null;
  interviewAddress: string | null;
}): string {
  switch (application.status) {
    case "UNDER_REVIEW":
      return "Your application is currently being evaluated by our hiring team. Thank you for your patience.";
    case "SHORTLISTED":
      return "Congratulations! Your profile has been shortlisted. Our recruitment team will contact you soon regarding the next steps.";
    case "INTERVIEW_SCHEDULED": {
      if (!application.interviewAt) {
        return "Your interview has been scheduled. Please check the interview details shared separately.";
      }
      let message = `Your interview has been scheduled for ${formatInterviewDateTimeIST(application.interviewAt)}.`;
      if (application.interviewMode === "ONLINE" && application.interviewMeetingLink) {
        message += ` Join here: ${application.interviewMeetingLink}`;
      } else if (application.interviewMode === "OFFLINE" && application.interviewAddress) {
        message += ` Venue: ${application.interviewAddress}`;
      } else {
        message += " Our HR team will share the mode and joining details separately.";
      }
      return message;
    }
    case "OFFERED":
      return "Congratulations! We are delighted to inform you that you have been selected for the position. Our HR team will reach out shortly with further details.";
    case "HIRED":
      return "Congratulations! You have officially joined Team Eduteria. We're thrilled to have you on board.";
    case "REJECTED":
      return "Thank you for your interest in Eduteria. After careful consideration, we have decided to move forward with other candidates. We truly appreciate your time and encourage you to apply for future opportunities that match your profile.";
    case "APPLIED":
    default:
      return "Your application has been successfully received and is currently under review.";
  }
}

function toWhatsAppNumber(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

async function sendCampaign(
  campaignName: string,
  destination: string,
  userName: string,
  templateParams: string[],
  apiKey: string,
): Promise<void> {
  const res = await fetch(AISENSY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      campaignName,
      destination,
      userName,
      templateParams,
      source: "workers-queue",
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      paramsFallbackValue: { FirstName: userName || "Student" },
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (data?.error || data?.success === false) {
    throw new Error(
      String(data?.error ?? data?.message ?? "AiSensy rejected the request"),
    );
  }
}

// ── Job data types (must match what the API pushes) ──────────────────────────

export type WhatsAppJobData =
  | { type: "welcome"; mobile: string; name: string }
  | {
      type: "campaign";
      mobile: string;
      studentName: string;
      campaignName: string;
      templateParams?: string[];
    }
  | {
      type: "job-application-status-changed";
      applicationId: string;
      newStatus: ApplicationStatus;
    };

// ── Queue (used by apps/api to push jobs) ────────────────────────────────────

export const whatsappQueue = new Queue<WhatsAppJobData>("whatsapp", {
  connection: bullmqConnection,
  prefix: REDIS_PREFIX,
});

// ── Worker ────────────────────────────────────────────────────────────────────

export function startWhatsAppWorker() {
  const apiKey = process.env.AISENSY_API_KEY ?? "";

  if (!apiKey) {
    console.warn(
      "⚠️  AISENSY_API_KEY is not set. WhatsApp worker will log but not send.",
    );
  }

  const worker = new Worker<WhatsAppJobData>(
    "whatsapp",
    async (job) => {
      const { data } = job;

      if (!apiKey) {
        console.log("[whatsapp] skipping (no API key):", data);
        return;
      }

      if (data.type === "welcome") {
        await sendCampaign(
          "welcome_enquiry_2026",
          toWhatsAppNumber(data.mobile),
          data.name,
          [data.name],
          apiKey,
        );
        console.log(`[whatsapp] welcome sent → ${data.mobile}`);
        return;
      }

      if (data.type === "campaign") {
        await sendCampaign(
          data.campaignName,
          toWhatsAppNumber(data.mobile),
          data.studentName,
          data.templateParams ?? [],
          apiKey,
        );
        console.log(
          `[whatsapp] campaign "${data.campaignName}" sent → ${data.mobile}`,
        );
        return;
      }

      if (data.type === "job-application-status-changed") {
        const application = await prisma.application.findUnique({
          where: { id: data.applicationId },
          include: { job: { select: { title: true } } },
        });
        if (!application) {
          console.warn(
            `[whatsapp] application ${data.applicationId} not found - skipping status WhatsApp`,
          );
          return;
        }

        const statusLabel = CAREER_STATUS_LABEL[application.status];
        const customMessage = careerStatusMessage(application);

        await sendCampaign(
          CAREER_STATUS_CAMPAIGN,
          toWhatsAppNumber(application.phone),
          application.name,
          [
            application.name,
            application.job.title,
            application.name,
            application.job.title,
            application.id,
            statusLabel,
            customMessage,
          ],
          apiKey,
        );
        console.log(
          `[whatsapp] status update (${application.status}) sent → ${application.phone}`,
        );
        return;
      }
    },
    { connection: bullmqConnection, prefix: REDIS_PREFIX },
  );

  worker.on("completed", (job) => {
    console.log(`[whatsapp] job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[whatsapp] job ${job?.id} failed:`, err.message);
  });

  console.log("[whatsapp] worker started");
  return worker;
}
