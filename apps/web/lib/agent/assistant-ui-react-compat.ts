import * as React from "react";

export default React;

const reactNamespace = React as typeof React & Record<string, unknown>;
const reactClientInternals =
  reactNamespace["__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE"];

export const __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =
  reactClientInternals;

// @assistant-ui/tap@0.6.0 falls back to this removed React internals export.
// React 19 exposes the newer client internals name above; keep the alias local
// to tap's dispatcher import so normal app React imports stay untouched.
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED =
  reactNamespace["__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED"] ??
  reactClientInternals;
