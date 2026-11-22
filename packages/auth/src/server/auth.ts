import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@repo/database";
import { smsService } from "./sms.service";
import { phoneNumber } from "better-auth/plugins";
import { trustedDevice } from "./trusted-device.plugin";

const rawOrigins =
  process.env.CORS_ORIGIN ?? "http://localhost:3000,http://localhost:7030";
const trustedOrigins = rawOrigins
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Google sign-in on the admin login page is restricted to staff Workspace
// domains. Google's own `hd` provider option only supports a single domain,
// so multi-domain restriction is enforced in the user.create hook below
// instead (see the emailVerified check for why this only affects OAuth sign-ups).
const allowedGoogleDomains = (
  process.env.GOOGLE_ALLOWED_DOMAINS ?? "nitp.ac.in"
)
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function isAllowedGoogleEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && allowedGoogleDomains.includes(domain);
}

const authBaseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:4000";
// Host-only cookies are the safe default. Cross-subdomain sharing requires an
// explicitly configured COOKIE_DOMAIN matching the deployment's public domain.
const cookieDomain = process.env.COOKIE_DOMAIN?.trim() || undefined;
if (cookieDomain) {
  const authHostname = new URL(authBaseUrl).hostname;
  const domainHostname = cookieDomain.replace(/^\./, "").toLowerCase();
  if (
    domainHostname.split(".").length < 2 ||
    !/^[a-z0-9.-]+$/.test(domainHostname) ||
    !(authHostname === domainHostname || authHostname.endsWith(`.${domainHostname}`))
  ) {
    throw new Error("COOKIE_DOMAIN must be a parent domain of BETTER_AUTH_URL");
  }
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins,
  trustedProxies: false,
  advanced: {
    crossSubDomainCookies: {
      enabled: Boolean(cookieDomain),
      domain: cookieDomain,
    },
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: authBaseUrl.startsWith("https://"),
    },
  },
  rateLimit: {
    window: 60, // 60 seconds
    max: 100, // 100 requests per IP per window
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      // Existing admin users were provisioned via phone/credential signup and
      // never went through an email-verification flow, so their local
      // emailVerified is false. Google's own OAuth email is independently
      // verified, so it's safe to link without requiring the local flag too.
      requireLocalEmailVerified: false,
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (user.emailVerified && !isAllowedGoogleEmail(user.email)) {
            throw new APIError("FORBIDDEN", {
              message:
                "Sign-in is restricted to vaultfs.com google accounts.",
            });
          }
        },
      },
    },
  },
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber, code }) => {
        const cooldown = await prisma.otpCooldown.findUnique({
          where: { phoneNumber },
        });
        if (cooldown && cooldown.expiresAt > new Date()) {
          throw new APIError("BAD_REQUEST", {
            message: "Please wait before requesting another OTP",
          });
        }

        const success = await smsService.sendOTP(phoneNumber, code);
        if (!success) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Failed to send OTP",
          });
        }

        await prisma.otpCooldown.upsert({
          where: { phoneNumber },
          create: { phoneNumber, expiresAt: new Date(Date.now() + 60000) },
          update: { expiresAt: new Date(Date.now() + 60000) },
        });
      },
      sendPasswordResetOTP: async ({ phoneNumber, code }) => {
        const cooldown = await prisma.otpCooldown.findUnique({
          where: { phoneNumber },
        });
        if (cooldown && cooldown.expiresAt > new Date()) {
          throw new APIError("BAD_REQUEST", {
            message: "Please wait before requesting another OTP",
          });
        }

        const success = await smsService.sendOTP(phoneNumber, code);
        if (!success) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Failed to send Password Reset OTP",
          });
        }

        await prisma.otpCooldown.upsert({
          where: { phoneNumber },
          create: { phoneNumber, expiresAt: new Date(Date.now() + 60000) },
          update: { expiresAt: new Date(Date.now() + 60000) },
        });
      },

      signUpOnVerification: {
        getTempName(phoneNumber) {
          return phoneNumber;
        },

        getTempEmail(phoneNumber) {
          return `${phoneNumber}@vaultfs.local`;
        },
      },
    }),
    trustedDevice(),
  ],
});
