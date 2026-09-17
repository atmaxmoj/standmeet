// AssembleView — the unified assembly view (one per seam): upload an OpenAPI spec to assemble a
// per-SaaS supplier.
//
// **The openapi half renders the real SupplierSpecIngest, not a second form hand-rolled here**
// (F-C-21). This used to have a textbox that only accepted one JSON blob `{ spec, binding }` — a
// different payload shape from the catalog-level form, and it wiped whatever candidate/plan/token
// was already filled when arriving from the catalog. Two implementations is drift itself.
//
// The former built-in-protocol form path (CalDAV/SMTP) is gone: both are blocks now, connected from
// their own backend-derived catalog cards (supplier-row-<id>), not assembled here. The seam-card
// entry point stays so an owner clicking Calendar knows they can bring their own OpenAPI calendar —
// but the seam has no effect on the openapi path (the seam is declared by the binding, backend
// BindingSeam, not by which card was clicked).

'use client';

import { SupplierSpecIngest } from '@/components/admin/SupplierSpecIngest';
import type { AssembleInput, AssembleState } from '@/lib/admin/use-supplier-upload';

export function AssembleView({ onAssemble, assemble }: {
  onAssemble?: (input: AssembleInput) => void;
  assemble?: AssembleState;
}) {
  return (
    <div className="sm-supplier-modal-body space-y-5">
      <SupplierSpecIngest onAssemble={onAssemble} assemble={assemble} />
    </div>
  );
}
