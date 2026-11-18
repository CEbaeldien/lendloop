// Convex accepts Clerk-issued JWTs from the "convex" JWT template.
// CLERK_JWT_ISSUER_DOMAIN is set on the Convex deployment (see README).
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
