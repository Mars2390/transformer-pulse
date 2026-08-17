"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { inputClass } from "@/components/ui/input-class";

export type TechnicianOption = {
  id: string;
  name: string;
  available: boolean;
  activeJobs: number;
  currentJobLabel: string | null;
};

/**
 * Name a technician, and start the job.
 *
 * Two buttons rather than one because they are two different claims. "Assign"
 * says this person will do it; "Start" says they have opened the transformer
 * and the clock on the work itself is running. Collapsing them would make queue
 * time indistinguishable from repair time on every turnaround figure, which is
 * the number the whole workshop is judged on.
 *
 * A busy technician is shown, greyed, WITH what they are holding. Hiding them
 * would leave a supervisor wondering whether the person is on leave, unassigned
 * or simply missing from a list.
 */
export function TechnicianAssign({
  repairId,
  technicians,
  assignedId,
  started,
}: {
  repairId: string;
  technicians: TechnicianOption[];
  assignedId: string | null;
  started: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [choice, setChoice] = useState(assignedId ?? "");
  const [busy, setBusy] = useState(false);

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? "That did not work.", "error");
        return false;
      }
      toast(data.message ?? "Saved.", "success");
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const noneExist = technicians.length === 0;
  const allBusy = !noneExist && technicians.every((t) => !t.available);

  if (noneExist) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
        No technicians are attached to this workshop. A technician is a store keeper whose store is
        the workshop — an admin sets that on the user, under Users.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="block text-xs font-bold text-navy">Who will repair this?</span>
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            disabled={busy || started}
            className={`${inputClass} mt-1 text-sm`}
          >
            <option value="">— Leave in the queue —</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id} disabled={!t.available && t.id !== assignedId}>
                {t.name}
                {t.available
                  ? " · free"
                  : t.id === assignedId
                    ? " · on this job"
                    : ` · busy with ${t.currentJobLabel ?? "another unit"}`}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={busy || started || choice === (assignedId ?? "")}
          onClick={() => post("/api/workshop/assign", { repairId, technicianId: choice || null })}
          className="inline-flex min-h-11 items-center rounded-xl border border-line bg-white px-4 text-xs font-bold text-navy hover:border-kplc disabled:opacity-40"
        >
          {choice ? "Assign" : "Return to queue"}
        </button>

        <button
          type="button"
          disabled={busy || started || !choice}
          onClick={() => post("/api/workshop/start", { repairId, technicianId: choice })}
          className="inline-flex min-h-11 items-center rounded-xl bg-kplc px-4 text-xs font-bold text-white hover:bg-kplc-dark disabled:opacity-40"
        >
          Start work
        </button>
      </div>

      {started ? (
        <p className="text-xs font-semibold text-kplc">
          Work has started. Record the outcome below when it is finished.
        </p>
      ) : allBusy ? (
        <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-900">
          Every technician is on a job. This unit waits in the queue — that wait is real and is worth
          seeing, which is why it is not hidden by assigning somebody a second transformer.
        </p>
      ) : (
        <p className="text-xs text-ink-soft">
          Assigning names the person. Starting records that the unit has been opened, and is what the
          turnaround clock measures from.
        </p>
      )}
    </div>
  );
}
