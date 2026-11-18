import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Page-level gate for signed-in areas. This is a UX convenience only:
// every Convex function enforces its own auth and role checks.
const isPrivate = createRouteMatcher(["/app(.*)", "/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPrivate(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
