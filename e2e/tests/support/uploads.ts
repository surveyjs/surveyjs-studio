import type { Locator, Page } from "@playwright/test";
import { csrfHeaders } from "./survey-list.js";
import { expect } from "./test.js";

/** A valid 1×1 PNG (67 bytes). */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** The 1×1 PNG followed by zero bytes up to `totalBytes`; browsers ignore data after the IEND chunk. */
export function paddedPng(totalBytes: number): Buffer {
  expect(totalBytes).toBeGreaterThanOrEqual(PNG_1X1.length);
  return Buffer.concat([PNG_1X1, Buffer.alloc(totalBytes - PNG_1X1.length)]);
}

/** Uploads a file to a survey through the API; the page must be signed in. */
export async function uploadViaApi(
  page: Page,
  surveyId: string,
  bytes: Buffer,
  name: string,
): Promise<{ id: string; url: string }> {
  const response = await page.request.post(`/api/v1/surveys/${surveyId}/assets`, {
    headers: await csrfHeaders(page),
    multipart: { file: { name, mimeType: "image/png", buffer: bytes } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; url: string };
}

/** The Creator's toast notification. */
export function creatorNotification(page: Page): Locator {
  return page.locator(".svc-notifier");
}
