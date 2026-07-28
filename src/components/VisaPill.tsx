import type { VisaStatus } from "../types";

const MAP: Record<VisaStatus, [string, string]> = {
  stated: ["pill-stated", "✓ Sponsorship stated"],
  likely: ["pill-likely", "◐ Likely sponsor"],
  unknown: ["pill-unknown", "· Sponsorship unclear"],
};

export default function VisaPill({ status }: { status?: VisaStatus }) {
  const [cls, label] = MAP[status as VisaStatus] || MAP.unknown;
  return <span className={"pill " + cls}>{label}</span>;
}
