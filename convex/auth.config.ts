import type { AuthConfig } from "convex/server";

// Clerk issues a JWT from its "convex" template; that template adds the
// `role` claim read by requireRole (convex/auth.ts).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
