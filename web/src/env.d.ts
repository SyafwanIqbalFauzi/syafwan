/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Set by the middleware on /hermes and /api/hermes once the session is verified. */
    hermesUser?: { id: string; email: string };
    /** The signed-in user's Directus access token (never sent to the browser). */
    hermesToken?: string;
  }
}
