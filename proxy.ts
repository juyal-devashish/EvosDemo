import { clerkMiddleware } from "@clerk/nextjs/server";

// Clerk session handling for every page. Access control is NOT done here:
// every Convex function checks the caller's role server-side.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
