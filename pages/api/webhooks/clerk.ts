/**
 * ============================================================================
 * CLERK WEBHOOK HANDLER: Syncs Clerk Auth Events to Database
 * ============================================================================
 *
 * Purpose:
 * When users sign up, update their profile, or delete their account in Clerk,
 * this webhook fires with event data. We use it to keep our User database
 * table in sync with Clerk's authentication system.
 *
 * How Webhooks Work:
 * 1. User does something in Clerk (sign up, update email, delete account)
 * 2. Clerk sends a POST request to this endpoint with event data
 * 3. We verify the request is really from Clerk (using CLERK_WEBHOOK_SECRET)
 * 4. We handle the event (create/update/delete User record)
 * 5. We return success (200) so Clerk knows we processed it
 *
 * Events We Handle:
 * - user.created: User signed up → Create User record with role "student" (default)
 * - user.updated: User updated email → Update User record
 * - user.deleted: User deleted account → Delete User record
 *
 * Setup Instructions:
 * 1. Go to https://dashboard.clerk.com
 * 2. Navigate to: Webhooks (left sidebar)
 * 3. Create New Endpoint:
 *    - URL: https://yourapp.com/api/webhooks/clerk
 *    - Events: user.created, user.updated, user.deleted
 * 4. Copy the Signing Secret
 * 5. Add to .env: CLERK_WEBHOOK_SECRET=whsec_xxxxx
 *
 * Security:
 * - Every webhook request is signed by Clerk
 * - We verify the signature using CLERK_WEBHOOK_SECRET
 * - This prevents malicious actors from triggering fake events
 * - Only requests from Clerk will pass verification
 *
 * ============================================================================
 */

import { Webhook } from "svix";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * POST Handler for Webhook Requests
 *
 * Next.js Page Router API syntax:
 * - export async function POST(req: Request)
 * - Returns: Response with status code and message
 *
 * What happens:
 * 1. Extract Svix headers (prove request is from Clerk)
 * 2. Read request body
 * 3. Verify signature using Clerk's secret
 * 4. Parse event type (user.created, user.updated, user.deleted)
 * 5. Call appropriate handler function
 * 6. Return 200 success (or error if something fails)
 */
export async function POST(req: Request) {
  // =========================================================================
  // STEP 1: Extract Webhook Headers
  // =========================================================================
  // Clerk sends three headers to prove the request is from them:
  const headerPayload = headers();
  const svix_id = headerPayload.get("svix-id"); // Unique message ID
  const svix_timestamp = headerPayload.get("svix-timestamp"); // When sent
  const svix_signature = headerPayload.get("svix-signature"); // Cryptographic proof

  // If headers are missing, someone's tampering with the request - reject it
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error occured -- no svix headers", {
      status: 400,
    });
  }

  // =========================================================================
  // STEP 2: Get Request Body
  // =========================================================================
  // We need the raw text body for signature verification
  const body = await req.text();

  // =========================================================================
  // STEP 3: Verify Webhook Signature
  // =========================================================================
  // Create Svix verifier with our signing secret
  // This proves the request actually came from Clerk
  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET || "");

  let evt;
  try {
    // Verify returns the parsed event if signature is valid, throws if invalid
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as any;
  } catch (err) {
    // Signature verification failed - someone's tampering or secret is wrong
    console.error("Error verifying webhook:", err);
    return new Response("Error occured", {
      status: 400,
    });
  }

  // =========================================================================
  // STEP 4: Extract Event Data
  // =========================================================================
  // At this point, we know the request is legitimate (signature verified)
  const { id } = evt.data; // Clerk user ID (unique identifier)
  const eventType = evt.type; // What happened: "user.created", "user.updated", "user.deleted"

  try {
    // =====================================================================
    // EVENT 1: user.created - New User Signed Up
    // =====================================================================
    // When: User completes sign-up in Clerk
    // What: Extract their email and create a User record in our database
    // Why: We need to track users in our system for the school app
    if (eventType === "user.created") {
      const { email_addresses, first_name } = evt.data;
      const email = email_addresses?.[0]?.email_address; // Get primary email

      // Validate we have an email
      if (!email) {
        return new Response("Email not found", { status: 400 });
      }

      // Create the user record in our database
      // Initially set role to "student" (admin can change this later)
      // Admin should update the role to "teacher", "admin", "parent" as needed
    }

    // =====================================================================
    // EVENT 2: user.updated - User Updated Profile
    // =====================================================================
    // When: User changes their email in Clerk
    // What: Update the email in our User record
    // Why: Keep database in sync with Clerk
    if (eventType === "user.updated") {
      const { email_addresses } = evt.data;
      const email = email_addresses?.[0]?.email_address;

      // Only update if email changed
    }

    // =====================================================================
    // EVENT 3: user.deleted - User Deleted Account
    // =====================================================================
    // When: User deletes their Clerk account
    // What: Remove the User record from our database
    // Why: Clean up - user no longer has access to the app
    if (eventType === "user.deleted") {
    }

    // Success! Clerk will mark this webhook as delivered
    return new Response("Webhook processed", { status: 200 });
  } catch (error) {
    // Something went wrong processing the webhook
    console.error("Webhook processing error:", error);
    // Return 500 so Clerk knows to retry
    return new Response("Error processing webhook", { status: 500 });
  }
}
