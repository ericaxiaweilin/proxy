// Generic, fail-closed dispatcher for server-defined Experience actions.
//
// The server may select only actions already present in the shared registry.
// It cannot provide implementation code, arbitrary routes, or arbitrary
// backend command names.

import {
  ExperienceActionSchema,
  type TasksExperienceParams
} from "@proxy/contracts";

export type ExperienceDispatchBindings = {
  openSurface(
    surface: "TASKS",
    params: TasksExperienceParams
  ): void;
};

export function dispatchExperienceAction(
  raw: unknown,
  bindings: ExperienceDispatchBindings
): boolean {
  const parsed = ExperienceActionSchema.safeParse(raw);

  if (!parsed.success) {
    return false;
  }

  const action = parsed.data;

  switch (action.type) {
    case "OPEN_SURFACE": {
      switch (action.surface) {
        case "TASKS":
          bindings.openSurface("TASKS", action.params);
          return true;
      }
    }
  }

  return false;
}
