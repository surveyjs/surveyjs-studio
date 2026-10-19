import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test, type FileChooser, type Locator, type Page } from "@playwright/test";
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

let chosenFiles = 0;

/**
 * Gives the chooser a file named `name` (its type from the extension) holding `bytes`, from disk:
 * WebKit sometimes sends a file set from a buffer (an in-memory File) with an empty body, a file
 * from disk never.
 */
export async function chooseFile(chooser: FileChooser, name: string, bytes: Buffer): Promise<void> {
  const path = test.info().outputPath(`chosen-${++chosenFiles}`, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  await chooser.setFiles(path);
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
