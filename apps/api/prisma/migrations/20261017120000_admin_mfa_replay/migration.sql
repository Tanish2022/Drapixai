-- Durable, atomic TOTP replay prevention across API replicas. No OTP or secret is stored.
ALTER TABLE "User" ADD COLUMN "adminTotpLastCounter" BIGINT;
ALTER TABLE "User" ADD CONSTRAINT "User_adminTotpLastCounter_nonnegative"
  CHECK ("adminTotpLastCounter" IS NULL OR "adminTotpLastCounter" >= 0);
