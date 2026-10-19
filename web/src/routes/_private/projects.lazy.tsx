import { createLazyFileRoute } from "@tanstack/react-router";
import { ProjectsPage } from "../../projects/ProjectsPage";

export const Route = createLazyFileRoute("/_private/projects")({ component: ProjectsPage });
