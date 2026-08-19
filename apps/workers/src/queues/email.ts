import { Worker, Queue } from "bullmq";
import nodemailer, { type Transporter } from "nodemailer";
import { prisma, type ApplicationStatus, type InterviewMode } from "@repo/database";
import { bullmqConnection, REDIS_PREFIX } from "../lib/redis";
import { env } from "../env";
import { EDUTERIA_LOGO_BASE64, EDUTERIA_LOGO_CID } from "../lib/email-logo";

// ── Job data types (must match what the API pushes) ──────────────────────────

export type EmailJobData =
  | { type: "job-application-received-hr"; applicationId: string }
  | { type: "job-application-confirmation"; applicationId: string }
  | {
      type: "job-application-status-changed";
      applicationId: string;
      newStatus: ApplicationStatus;
    };

// ── Queue (used by apps/api to push jobs) ────────────────────────────────────

export const emailQueue = new Queue<EmailJobData>("email", {
  connection: bullmqConnection,
  prefix: REDIS_PREFIX,
});

// ── Transporter ───────────────────────────────────────────────────────────────

let warnedNoSmtp = false;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    if (!warnedNoSmtp) {
      console.warn(
        "⚠️  SMTP_HOST/SMTP_USER/SMTP_PASS are not fully set. Email worker will log but not send.",
      );
      warnedNoSmtp = true;
    }
    return null;
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(
      `[email] skipping send (no SMTP configured) → ${opts.to}: ${opts.subject}`,
    );
    return;
  }

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: opts.to,
    replyTo: opts.replyTo,
    subject: opts.subject,
    html: opts.html,
    // Logo is embedded via CID, not a data URI or external URL, so it renders
    // inline in the email body itself without any external image request and
    // without bloating the HTML payload (which risks Gmail's clipping limit).
    attachments: [
      {
        filename: "eduteria-logo.png",
        content: Buffer.from(EDUTERIA_LOGO_BASE64, "base64"),
        cid: EDUTERIA_LOGO_CID,
        contentType: "image/png",
      },
    ],
  });
}

// ── Shared brand tokens ───────────────────────────────────────────────────────

const BRAND = {
  crimson: "#ba0035",
  crimsonDark: "#8b0025",
  navy: "#1a1a2e",
  gold: "#c9974d",
  ink: "#1a1a2e",
  muted: "#6b6b7a",
  border: "#eee0e3",
  cardBg: "#fff8f9",
};

function formatDateIST(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatInterviewParts(date: Date): {
  weekday: string;
  date: string;
  time: string;
} {
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
  return { weekday, date: dateStr, time };
}

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  INTERNSHIP: "Internship",
  CONTRACT: "Contract",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Premium, mobile-friendly layout shell ─────────────────────────────────────
// Hybrid-coded (table layout + a <style> block for the clients that honor it)
// so it renders consistently across Gmail, Outlook, Apple Mail and mobile apps.

function emailLayout(opts: {
  preheader: string;
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  accentColor?: string;
}): string {
  const accent = opts.accentColor ?? BRAND.crimson;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta name="color-scheme" content="light"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>Eduteria</title>
<style>
  body,table,td { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  img { border:0; line-height:100%; outline:none; -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  @media only screen and (max-width:600px) {
    .email-container { width:100% !important; border-radius:0 !important; }
    .px { padding-left:16px !important; padding-right:16px !important; }
    .stack { display:block !important; width:100% !important; }
    .h1 { font-size:19px !important; }
    .body-copy { font-size:13.5px !important; }
    .card-box { padding:16px !important; }
    .card-title { font-size:10px !important; }
    .details-label { width:100% !important; display:block !important; padding-bottom:1px !important; }
    .details-label span { font-size:10px !important; }
    .details-value { width:100% !important; display:block !important; padding-left:0 !important; padding-top:0 !important; }
    .details-value span { font-size:13px !important; }
    .cta-btn a { padding:11px 22px !important; font-size:13px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f2eef0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <!-- Preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
    ${escapeHtml(opts.preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2eef0;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(26,26,46,0.10);">

          <!-- Header -->
          <tr>
            <td class="px" style="background:linear-gradient(135deg,${BRAND.crimson} 0%,${BRAND.crimsonDark} 100%);padding:32px 40px 26px;" align="center">
              <img src="cid:${EDUTERIA_LOGO_CID}" width="150" alt="Eduteria" style="display:block;width:150px;max-width:150px;height:auto;margin:0 auto 14px;"/>
              <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.22em;color:rgba(255,255,255,0.82);text-align:center;">
                ${escapeHtml(opts.eyebrow)}
              </p>
            </td>
          </tr>

          <!-- Gold accent rule -->
          <tr>
            <td style="height:3px;line-height:3px;font-size:0;background:linear-gradient(90deg,${BRAND.gold} 0%,${accent} 50%,${BRAND.gold} 100%);">&nbsp;</td>
          </tr>

          <!-- Heading -->
          <tr>
            <td class="px" style="padding:34px 40px 6px;">
              <h1 class="h1" style="margin:0;font-size:24px;line-height:1.3;font-weight:800;color:${BRAND.ink};">
                ${opts.heading}
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="px body-copy" style="padding:14px 40px 8px;color:${BRAND.ink};font-size:15px;line-height:1.7;">
              ${opts.bodyHtml}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td class="px" style="padding:12px 40px 0;">
              <div style="border-top:1px solid ${BRAND.border};"></div>
            </td>
          </tr>

          <!-- Support strip -->
          <tr>
            <td class="px" style="padding:22px 40px 30px;">
              <p style="margin:0;font-size:13px;color:${BRAND.muted};line-height:1.7;">
                Need help or have a question about this email? Reach us anytime at
                <a href="mailto:support@eduteria.com" style="color:${BRAND.crimson};font-weight:600;">support@eduteria.com</a>
                or visit <a href="https://eduteria.com" style="color:${BRAND.crimson};font-weight:600;">eduteria.com</a>.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${BRAND.navy};padding:26px 40px;" align="center">
              <img src="cid:${EDUTERIA_LOGO_CID}" width="96" alt="Eduteria" style="display:block;width:96px;max-width:96px;height:auto;margin:0 auto 10px;opacity:0.92;filter:grayscale(1) brightness(4);"/>
              <p style="margin:0 0 6px;font-size:12px;color:#c9c9d6;text-align:center;">
                Eduteria &middot; BPSC &amp; UPSC Exam Preparation
              </p>
              <p style="margin:0;font-size:11px;color:#7d7d8c;text-align:center;">
                &copy; ${new Date().getFullYear()} Eduteria. All rights reserved. &middot; <a href="https://eduteria.com" style="color:#9a9aad;">eduteria.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Reusable content fragments ────────────────────────────────────────────────

function detailsCard(
  rows: { label: string; value: string }[],
  title = "Application Details",
): string {
  const rowsHtml = rows
    .filter((r) => r.value)
    .map(
      (r, i) => `
        <tr>
          <td class="details-label" style="padding:11px 0;border-bottom:${
            i === rows.length - 1 ? "none" : `1px solid ${BRAND.border}`
          };vertical-align:top;width:40%;">
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${BRAND.crimson};">${escapeHtml(r.label)}</span>
          </td>
          <td class="details-value" style="padding:11px 0 11px 16px;border-bottom:${
            i === rows.length - 1 ? "none" : `1px solid ${BRAND.border}`
          };vertical-align:top;">
            <span style="font-size:14.5px;color:${BRAND.ink};font-weight:600;">${r.value}</span>
          </td>
        </tr>`,
    )
    .join("");

  return `
    <div class="card-box" style="margin:18px 0;background:${BRAND.cardBg};border:1px solid #fbe1e6;border-radius:12px;padding:22px 24px;">
      <p class="card-title" style="margin:0 0 12px;font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.crimsonDark};">${escapeHtml(title)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${rowsHtml}
      </table>
    </div>`;
}

function ctaButton(label: string, href: string, color = BRAND.crimson): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" class="cta-btn" style="margin:22px 0 6px;">
      <tr>
        <td style="border-radius:8px;background:${color};">
          <a href="${href}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">${escapeHtml(label)} &rarr;</a>
        </td>
      </tr>
    </table>`;
}

function interviewPanel(
  interviewAt: Date,
  interviewMode: InterviewMode | null,
  interviewMeetingLink: string | null,
  interviewAddress: string | null,
): string {
  const { weekday, date, time } = formatInterviewParts(interviewAt);

  let modeHtml = `<p style="margin:14px 0 0;font-size:12.5px;color:${BRAND.muted};line-height:1.6;">Our HR team will separately share the interview mode (online / in-person) and any joining details you may need.</p>`;

  if (interviewMode === "ONLINE" && interviewMeetingLink) {
    modeHtml = `
      <div style="margin:16px 0 0;padding-top:14px;border-top:1px solid #d8e0ff;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#3a5fce;">💻 Online Interview</p>
        <a href="${escapeHtml(interviewMeetingLink)}" style="font-size:14px;font-weight:700;color:#3a5fce;word-break:break-all;">${escapeHtml(interviewMeetingLink)}</a>
      </div>`;
  } else if (interviewMode === "OFFLINE" && interviewAddress) {
    modeHtml = `
      <div style="margin:16px 0 0;padding-top:14px;border-top:1px solid #d8e0ff;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#3a5fce;">📍 In-Person Interview</p>
        <p style="margin:0;font-size:14px;font-weight:600;color:${BRAND.ink};white-space:pre-line;">${escapeHtml(interviewAddress)}</p>
      </div>`;
  }

  return `
    <div class="card-box" style="margin:18px 0;background:linear-gradient(135deg,#eef2ff 0%,#f5f0ff 100%);border:1px solid #d8e0ff;border-radius:12px;padding:22px 24px;">
      <p class="card-title" style="margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#3a5fce;">📅 Your Interview Is Scheduled</p>
      <p style="margin:0;font-size:19px;font-weight:800;color:${BRAND.ink};">${escapeHtml(weekday)}, ${escapeHtml(date)}</p>
      <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#3a5fce;">${escapeHtml(time)} (IST)</p>
      <p style="margin:14px 0 0;font-size:12.5px;color:${BRAND.muted};line-height:1.6;">Please be available a few minutes early.</p>
      ${modeHtml}
    </div>`;
}

function statusBadge(label: string, color: string, bg: string): string {
  return `<span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:${color};background:${bg};">${escapeHtml(label)}</span>`;
}

/** Ordered candidate-facing pipeline, used to render a "you are here" tracker. */
const PIPELINE_STAGES: { key: ApplicationStatus; label: string }[] = [
  { key: "APPLIED", label: "Applied" },
  { key: "UNDER_REVIEW", label: "Under Review" },
  { key: "SHORTLISTED", label: "Shortlisted" },
  { key: "INTERVIEW_SCHEDULED", label: "Interview" },
  { key: "OFFERED", label: "Offer" },
  { key: "HIRED", label: "Hired" },
];

function pipelineTracker(current: ApplicationStatus): string {
  if (current === "REJECTED") return "";
  const currentIndex = PIPELINE_STAGES.findIndex((s) => s.key === current);

  const cells = PIPELINE_STAGES.map((stage, i) => {
    const reached = i <= currentIndex;
    const isCurrent = i === currentIndex;
    const dotColor = reached ? BRAND.crimson : "#e3dde0";
    const textColor = reached ? BRAND.ink : BRAND.muted;
    return `
      <td align="center" style="padding:0 4px;">
        <div style="width:${isCurrent ? 14 : 10}px;height:${isCurrent ? 14 : 10}px;border-radius:50%;background:${dotColor};margin:0 auto 6px;${isCurrent ? `box-shadow:0 0 0 4px ${BRAND.cardBg};` : ""}"></div>
        <span style="font-size:10px;font-weight:${isCurrent ? 800 : 600};color:${textColor};white-space:nowrap;">${escapeHtml(stage.label)}</span>
      </td>`;
  }).join(`<td style="width:100%;padding-bottom:16px;"><div style="height:2px;background:${BRAND.border};"></div></td>`);

  return `
    <div style="margin:20px 0 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
    </div>`;
}

// ── Lookups ────────────────────────────────────────────────────────────────

async function getApplicationWithJob(applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { job: { include: { department: true } } },
  });

  if (!application) {
    throw new Error(`[email] Application ${applicationId} not found`);
  }

  return application;
}

async function getHrRecipients(): Promise<
  { email: string; name: string | null }[]
> {
  const hrUsers = await prisma.user.findMany({
    where: { roles: { some: { role: { name: "HR" } } } },
    select: { email: true, name: true },
  });

  return hrUsers.filter((u): u is { email: string; name: string | null } =>
    Boolean(u.email),
  );
}

// ── Email builders (pure functions - no DB access, easy to unit-test/preview) ─

type ApplicationForEmail = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: ApplicationStatus;
  createdAt: Date;
  interviewAt: Date | null;
  interviewMode: InterviewMode | null;
  interviewMeetingLink: string | null;
  interviewAddress: string | null;
  job: {
    title: string;
    location: string;
    employmentType: string;
    department: { name: string };
  };
};

export function buildHrNotificationEmail(application: ApplicationForEmail): {
  subject: string;
  html: string;
} {
  const bodyHtml = `
    <p style="margin:0 0 6px;">A new candidate just applied through the careers page.</p>
    ${detailsCard(
      [
        { label: "Applicant", value: escapeHtml(application.name) },
        {
          label: "Contact",
          value: `${escapeHtml(application.email)}<br/><a href="tel:${application.phone.replace(/\s/g, "")}" style="color:${BRAND.crimson};">${escapeHtml(application.phone)}</a>`,
        },
        { label: "Position", value: escapeHtml(application.job.title) },
        { label: "Department", value: escapeHtml(application.job.department.name) },
        { label: "Location", value: escapeHtml(application.job.location) },
        {
          label: "Employment Type",
          value: escapeHtml(
            EMPLOYMENT_TYPE_LABEL[application.job.employmentType] ??
              application.job.employmentType,
          ),
        },
        { label: "Applied On", value: formatDateIST(application.createdAt) },
      ],
      "Candidate Snapshot",
    )}
    <div style="margin-top:4px;background:#fff8f9;border:1px solid #fdd;border-radius:8px;padding:14px 18px;">
      <p style="margin:0;font-size:13px;color:#6b2535;font-weight:700;">Action Required</p>
      <p style="margin:6px 0 0;font-size:13px;color:#444;">Review the resume and custom-field answers, then update the application status from the Admin Portal under <strong>Careers &rarr; Applications</strong>.</p>
    </div>
    ${ctaButton("Open in Admin Portal", "https://eduteria.com/admin/careers")}
  `;

  return {
    subject: `New application: ${application.job.title} — ${application.name}`,
    html: emailLayout({
      preheader: `${application.name} just applied for ${application.job.title}.`,
      eyebrow: "Eduteria Careers · Internal Notification",
      heading: "📋 New Job Application Received",
      bodyHtml,
    }),
  };
}

export function buildConfirmationEmail(application: ApplicationForEmail): {
  subject: string;
  html: string;
} {
  const firstName = application.name.trim().split(/\s+/)[0] || application.name;

  const bodyHtml = `
    <p style="margin:0 0 4px;">Hi ${escapeHtml(firstName)},</p>
    <p style="margin:0 0 4px;">
      Thank you for applying to <strong>Eduteria</strong> — India's trusted platform for BPSC &amp; UPSC exam preparation.
      We're delighted you're interested in joining our team, and we've successfully received your application
      for the role below.
    </p>

    ${detailsCard([
      { label: "Position", value: escapeHtml(application.job.title) },
      { label: "Department", value: escapeHtml(application.job.department.name) },
      { label: "Location", value: escapeHtml(application.job.location) },
      {
        label: "Employment Type",
        value: escapeHtml(
          EMPLOYMENT_TYPE_LABEL[application.job.employmentType] ??
            application.job.employmentType,
        ),
      },
      { label: "Applicant Name", value: escapeHtml(application.name) },
      { label: "Email", value: escapeHtml(application.email) },
      { label: "Phone", value: escapeHtml(application.phone) },
      { label: "Application ID", value: `<span style="font-family:Consolas,monospace;">${escapeHtml(application.id)}</span>` },
      { label: "Submitted On", value: formatDateIST(application.createdAt) },
      { label: "Resume", value: "✅ Received &amp; attached to your profile" },
    ])}

    <p style="margin:22px 0 8px;font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.crimsonDark};">Where you are in the process</p>
    ${pipelineTracker(application.status)}

    <p style="margin:22px 0 8px;font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.crimsonDark};">What happens next</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="28" valign="top" style="padding:4px 10px 12px 0;"><div style="width:20px;height:20px;border-radius:50%;background:${BRAND.crimson};color:#fff;font-size:11px;font-weight:800;line-height:20px;text-align:center;">1</div></td>
        <td valign="top" style="padding-bottom:12px;font-size:14px;color:${BRAND.ink};">Our HR team reviews every application against the role's requirements.</td>
      </tr>
      <tr>
        <td width="28" valign="top" style="padding:4px 10px 12px 0;"><div style="width:20px;height:20px;border-radius:50%;background:${BRAND.crimson};color:#fff;font-size:11px;font-weight:800;line-height:20px;text-align:center;">2</div></td>
        <td valign="top" style="padding-bottom:12px;font-size:14px;color:${BRAND.ink};">Shortlisted candidates are contacted directly by email or phone for the next steps.</td>
      </tr>
      <tr>
        <td width="28" valign="top" style="padding:4px 10px 0 0;"><div style="width:20px;height:20px;border-radius:50%;background:${BRAND.crimson};color:#fff;font-size:11px;font-weight:800;line-height:20px;text-align:center;">3</div></td>
        <td valign="top" style="font-size:14px;color:${BRAND.ink};">You'll receive an email every time your application status changes — no need to follow up.</td>
      </tr>
    </table>

    ${ctaButton("Explore More Openings", "https://eduteria.com/careers")}

    <p style="margin:22px 0 0;font-size:13px;color:${BRAND.muted};">
      Wishing you the very best — we're excited to learn more about you.
    </p>
    <p style="margin:14px 0 0;font-size:14px;color:${BRAND.ink};">
      Warm regards,<br/><strong>Team Eduteria</strong>
    </p>
  `;

  return {
    subject: `We've received your application — ${application.job.title}`,
    html: emailLayout({
      preheader: `Thanks for applying to ${application.job.title} at Eduteria. Here's what happens next.`,
      eyebrow: "Eduteria Careers",
      heading: "🎉 Your Application Has Been Received!",
      bodyHtml,
    }),
  };
}

const STATUS_META: Record<
  ApplicationStatus,
  { badge: string; color: string; bg: string; accent: string }
> = {
  APPLIED: { badge: "Applied", color: "#8b5e00", bg: "#fff4d6", accent: BRAND.crimson },
  UNDER_REVIEW: { badge: "Under Review", color: "#8b5e00", bg: "#fff4d6", accent: "#c9974d" },
  SHORTLISTED: { badge: "Shortlisted", color: "#1a5f3f", bg: "#dcf5e8", accent: "#1a8f5f" },
  INTERVIEW_SCHEDULED: { badge: "Interview Stage", color: "#1a3f8f", bg: "#dde8ff", accent: "#3a5fce" },
  OFFERED: { badge: "Offer Extended", color: "#7a1a8f", bg: "#f3ddff", accent: "#a13ac9" },
  HIRED: { badge: "Hired", color: "#0f5132", bg: "#d1f7dd", accent: "#1aa15f" },
  REJECTED: { badge: "Not Selected", color: "#6b6b7a", bg: "#eee0e3", accent: "#8b6b70" },
};

function statusBody(
  application: ApplicationForEmail,
  status: ApplicationStatus,
): { subject: string; heading: string; message: string } {
  const jobTitle = escapeHtml(application.job.title);
  switch (status) {
    case "UNDER_REVIEW":
      return {
        subject: `Your application is under review — ${application.job.title}`,
        heading: "🔍 Your Application Is Under Review",
        message: `Great news — your application for <strong>${jobTitle}</strong> has moved forward and is now being reviewed by our hiring team. We're carefully evaluating your profile against the role and will update you as soon as there's news.`,
      };
    case "SHORTLISTED":
      return {
        subject: `You've been shortlisted — ${application.job.title}`,
        heading: "⭐ You've Been Shortlisted!",
        message: `Congratulations — you've been <strong>shortlisted</strong> for <strong>${jobTitle}</strong>. This puts you among our top candidates for the role. Our HR team will reach out shortly with next steps, so please keep an eye on your inbox and phone.`,
      };
    case "INTERVIEW_SCHEDULED":
      return {
        subject: `Interview scheduled — ${application.job.title}`,
        heading: "🗓️ Your Interview Has Been Scheduled",
        message: application.interviewAt
          ? `Excellent news — you've been selected for an <strong>interview</strong> for <strong>${jobTitle}</strong>. Your interview date and time are confirmed below — we're looking forward to speaking with you.`
          : `Excellent news — you've been selected for an <strong>interview</strong> for <strong>${jobTitle}</strong>. Our HR team will reach out separately with the interview schedule, format, and any preparation details. We're looking forward to speaking with you.`,
      };
    case "OFFERED":
      return {
        subject: `An offer for you — ${application.job.title}`,
        heading: "🎊 Congratulations — An Offer Awaits You!",
        message: `We are delighted to inform you that Eduteria would like to offer you the position of <strong>${jobTitle}</strong>. Our HR team will be in touch shortly with your offer letter and all the details you need to make your decision.`,
      };
    case "HIRED":
      return {
        subject: `Welcome to Eduteria — ${application.job.title}`,
        heading: "🎉 Welcome to the Eduteria Family!",
        message: `It's official — you've joined Eduteria as <strong>${jobTitle}</strong>! We're thrilled to have you on board and can't wait to see the impact you'll make. Our team will reach out with onboarding details ahead of your start date.`,
      };
    case "REJECTED":
      return {
        subject: `Update on your application — ${application.job.title}`,
        heading: "Update on Your Application",
        message: `Thank you for your interest in <strong>${jobTitle}</strong> and for the time you invested in our process. After careful consideration, we've decided to move forward with other candidates at this time. This is by no means a reflection of your abilities — we encourage you to apply for future openings that match your profile.`,
      };
    case "APPLIED":
    default:
      return {
        subject: `Update on your application — ${application.job.title}`,
        heading: "An Update on Your Application",
        message: `There's an update on your application for <strong>${jobTitle}</strong>. Please check back with our team for details.`,
      };
  }
}

export function buildStatusChangeEmail(
  application: ApplicationForEmail,
  newStatus: ApplicationStatus,
): { subject: string; html: string } {
  const { subject, heading, message } = statusBody(application, newStatus);
  const meta = STATUS_META[newStatus];
  const firstName = application.name.trim().split(/\s+/)[0] || application.name;

  const bodyHtml = `
    <p style="margin:0 0 14px;">Hi ${escapeHtml(firstName)}, ${statusBadge(meta.badge, meta.color, meta.bg)}</p>
    <p style="margin:0 0 4px;">${message}</p>

    ${
      newStatus === "INTERVIEW_SCHEDULED" && application.interviewAt
        ? interviewPanel(
            application.interviewAt,
            application.interviewMode,
            application.interviewMeetingLink,
            application.interviewAddress,
          )
        : ""
    }

    ${detailsCard([
      { label: "Position", value: escapeHtml(application.job.title) },
      { label: "Department", value: escapeHtml(application.job.department.name) },
      { label: "Location", value: escapeHtml(application.job.location) },
      { label: "Application ID", value: `<span style="font-family:Consolas,monospace;">${escapeHtml(application.id)}</span>` },
      { label: "Current Status", value: statusBadge(meta.badge, meta.color, meta.bg) },
    ])}

    ${newStatus !== "REJECTED" && newStatus !== "HIRED" ? `
      <p style="margin:22px 0 8px;font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.crimsonDark};">Where you are in the process</p>
      ${pipelineTracker(newStatus)}
    ` : ""}

    ${ctaButton("View Open Roles", "https://eduteria.com/careers", meta.accent)}

    <p style="margin:22px 0 0;font-size:14px;color:${BRAND.ink};">
      ${newStatus === "REJECTED" ? "We hope to see your application again soon." : "Thank you for your patience — we'll keep you posted."}<br/>
      <strong>Team Eduteria</strong>
    </p>
  `;

  return {
    subject,
    html: emailLayout({
      preheader: message.replace(/<[^>]+>/g, ""),
      eyebrow: "Eduteria Careers",
      heading,
      bodyHtml,
      accentColor: meta.accent,
    }),
  };
}

// ── Worker ────────────────────────────────────────────────────────────────────

export function startEmailWorker() {
  // Trigger the "not configured" warning once at startup rather than per-email.
  getTransporter();

  const worker = new Worker<EmailJobData>(
    "email",
    async (job) => {
      const { data } = job;

      if (data.type === "job-application-received-hr") {
        const application = await getApplicationWithJob(data.applicationId);
        const hrRecipients = await getHrRecipients();

        if (hrRecipients.length === 0) {
          console.warn(
            `[email] no HR-role users with an email found - skipping HR notification for application ${application.id}`,
          );
          return;
        }

        const { subject, html } = buildHrNotificationEmail(application);
        await sendEmail({
          to: hrRecipients.map((r) => r.email).join(","),
          subject,
          html,
        });
        console.log(
          `[email] HR notification sent for application ${application.id}`,
        );
        return;
      }

      if (data.type === "job-application-confirmation") {
        const application = await getApplicationWithJob(data.applicationId);
        const { subject, html } = buildConfirmationEmail(application);

        await sendEmail({ to: application.email, subject, html });
        console.log(
          `[email] confirmation sent for application ${application.id}`,
        );
        return;
      }

      if (data.type === "job-application-status-changed") {
        const application = await getApplicationWithJob(data.applicationId);
        const { subject, html } = buildStatusChangeEmail(
          application,
          data.newStatus,
        );

        await sendEmail({ to: application.email, subject, html });
        console.log(
          `[email] status-changed (${data.newStatus}) email sent for application ${application.id}`,
        );
        return;
      }
    },
    { connection: bullmqConnection, prefix: REDIS_PREFIX },
  );

  worker.on("completed", (job) => {
    console.log(`[email] job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[email] job ${job?.id} failed:`, err.message);
  });

  console.log("[email] worker started");
  return worker;
}
