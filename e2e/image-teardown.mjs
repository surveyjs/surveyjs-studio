// Global teardown of the image target (E2E_TARGET=image): saves the containers' logs and removes
// them. Playwright stops the `docker run` clients itself, but a killed client leaves its container.
import { removeImageContainers } from "./image-target.mjs";

export default function teardown() {
  removeImageContainers();
}
