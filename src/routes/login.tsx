import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout for the /login tree (login itself, forgot-password) — each child
// route renders its own full page chrome, this just wires up the path.
export const Route = createFileRoute("/login")({
  component: Outlet,
});
