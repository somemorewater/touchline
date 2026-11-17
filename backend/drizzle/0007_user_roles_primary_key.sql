-- Give pgAdmin and other database clients a stable row identifier for editing
-- role assignments. Existing role scope uniqueness rules remain unchanged.
ALTER TABLE "user_roles"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");
