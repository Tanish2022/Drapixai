-- Existing tokens are not assigned invented expirations or refresh credentials.
-- They require a fresh authorization before background API access.
ALTER TABLE "ShopifyInstallation"
  ADD COLUMN "encryptedRefreshToken" TEXT,
  ADD COLUMN "accessTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3);

CREATE TABLE "ShopifyTokenLease" (
  "shopDomain" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShopifyTokenLease_pkey" PRIMARY KEY ("shopDomain")
);
