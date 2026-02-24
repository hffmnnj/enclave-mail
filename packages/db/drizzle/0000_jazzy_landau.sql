CREATE TYPE "public"."keypair_type" AS ENUM('x25519', 'ed25519');--> statement-breakpoint
CREATE TYPE "public"."mailbox_type" AS ENUM('inbox', 'sent', 'drafts', 'trash', 'archive', 'custom');--> statement-breakpoint
CREATE TYPE "public"."message_flag" AS ENUM('seen', 'flagged', 'deleted', 'draft', 'answered');--> statement-breakpoint
CREATE TYPE "public"."prekey_type" AS ENUM('signed', 'one_time');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"srp_salt" "bytea" NOT NULL,
	"srp_verifier" "bytea" NOT NULL,
	"key_export_confirmed" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "keypairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "keypair_type" NOT NULL,
	"public_key" "bytea" NOT NULL,
	"encrypted_private_key" "bytea" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "mailbox_type" NOT NULL,
	"uid_validity" integer NOT NULL,
	"uid_next" integer DEFAULT 1 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"uid" integer NOT NULL,
	"message_id" text,
	"in_reply_to" text,
	"from_address" text NOT NULL,
	"to_addresses" jsonb NOT NULL,
	"subject_encrypted" "bytea",
	"date" timestamp with time zone NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"dkim_status" text,
	"spf_status" text,
	"dmarc_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_bodies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"encrypted_body" "bytea" NOT NULL,
	"content_type" text DEFAULT 'text/plain' NOT NULL,
	"encryption_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prekeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key_id" integer NOT NULL,
	"public_key" "bytea" NOT NULL,
	"signature" "bytea",
	"key_type" "prekey_type" NOT NULL,
	"is_used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "keypairs" ADD CONSTRAINT "keypairs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bodies" ADD CONSTRAINT "message_bodies_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prekeys" ADD CONSTRAINT "prekeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "keypairs_user_type_active_idx" ON "keypairs" USING btree ("user_id","type","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_expires_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_user_name_idx" ON "mailboxes" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "mailboxes_user_idx" ON "mailboxes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_mailbox_uid_unique_idx" ON "messages" USING btree ("mailbox_id","uid");--> statement-breakpoint
CREATE INDEX "messages_mailbox_idx" ON "messages" USING btree ("mailbox_id");--> statement-breakpoint
CREATE INDEX "messages_mailbox_uid_idx" ON "messages" USING btree ("mailbox_id","uid");--> statement-breakpoint
CREATE INDEX "messages_mailbox_date_desc_idx" ON "messages" USING btree ("mailbox_id","date" desc);--> statement-breakpoint
CREATE INDEX "messages_message_id_idx" ON "messages" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_bodies_message_id_unique_idx" ON "message_bodies" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "prekeys_user_type_used_created_idx" ON "prekeys" USING btree ("user_id","key_type","is_used","created_at");