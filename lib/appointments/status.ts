export const ALLOWED_STATUSES = [
  "scheduled",
  "checked_in",
  "late",
  "no_show",
  "canceled",
] as const;

export type Status = (typeof ALLOWED_STATUSES)[number];

export function normalizeStatus(input: unknown): Status | null {
  const s = String(input ?? "").trim().toLowerCase();
  return (ALLOWED_STATUSES as readonly string[]).includes(s)
    ? (s as Status)
    : null;
}

type ValidateOptions = {
  hasCheckedIn: boolean;
};

function isTerminal(status: Status): boolean {
  return status === "checked_in" || status === "no_show" || status === "canceled";
}

function allowedNextStatuses(current: Status): Set<Status> {
  // reglas simples y estrictas (más fácil de mantener y de endurecer sin sorpresas)
  switch (current) {
    case "scheduled":
      return new Set(["scheduled", "late", "checked_in", "no_show", "canceled"]);
    case "late":
      return new Set(["late", "checked_in", "no_show", "canceled"]);
    case "checked_in":
      return new Set(["checked_in"]);
    case "no_show":
      return new Set(["no_show"]);
    case "canceled":
      return new Set(["canceled"]);
    default: {
      const _exhaustive: never = current;
      return new Set([_exhaustive]);
    }
  }
}

export function validateStatusTransition(
  current: Status,
  next: Status,
  opts: ValidateOptions
): string | null {
  // si existe checked_in_at, tratamos la cita como checked_in sí o sí
  // (evita estados inconsistentes tipo checked_in_at != null pero status = no_show)
  if (opts.hasCheckedIn) {
    if (next !== "checked_in") {
      return "Checked-in appointments cannot change status.";
    }
    return null;
  }

  // terminales: no se cambian (salvo idempotencia: mismo status)
  if (isTerminal(current) && next !== current) {
    if (current === "no_show") {
      return "No-show appointments cannot change status (use Excuse).";
    }
    if (current === "canceled") {
      return "Canceled appointments cannot be modified.";
    }
    return "Checked-in appointments cannot change status.";
  }

  const allowed = allowedNextStatuses(current);
  if (!allowed.has(next)) {
    return `Invalid status transition: ${current} -> ${next}`;
  }

  return null;
}
