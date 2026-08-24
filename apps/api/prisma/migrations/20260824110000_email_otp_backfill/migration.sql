-- Verification moved from phone OTP to email OTP: carry over accounts that
-- were already verified so they stay ACTIVE.
UPDATE "User" SET "emailVerified" = true WHERE "phoneVerified" = true;
