import { Suspense } from "react";
import { StagingGateForm } from "./StagingGateForm";

export const dynamic = "force-dynamic";

export default function StagingGatePage() {
  return (
    <div className="stg-gate">
      <div className="stg-gate-blur" aria-hidden />
      <div className="stg-gate-veil" aria-hidden />
      <Suspense fallback={<div className="stg-gate-card">Загрузка…</div>}>
        <StagingGateForm />
      </Suspense>
    </div>
  );
}
