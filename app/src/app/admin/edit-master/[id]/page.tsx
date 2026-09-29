// edit-master/[id] —— the master editor route (docs/design/resume-masters.md): a résumé master in
// the same Puck composer, in master mode (MasterComposer).

'use client';

import { useParams } from 'next/navigation';

import { MasterComposer } from '@/components/admin/composer/MasterComposer';
import { Skel } from '@/components/skeletons/Skel';
import { useMasterDetail, type MasterView } from '@/lib/admin/use-resume-masters';

export default function EditMasterPage() {
  const params = useParams();
  const id = typeof params?.['id'] === 'string' ? params['id'] : '';
  const { master, error } = useMasterDetail(id);
  return <EditMasterBody master={master} error={error} />;
}

function EditMasterBody({ master, error }: { master: MasterView | null; error: string | null }) {
  return error !== null
    ? <p data-testid="edit-master-error" className="p-6 text-(--color-accent)">{error}</p>
    : master === null
      ? <div data-testid="edit-master-loading" className="p-6"><Skel h="h-8" w="w-64" /></div>
      : <MasterComposer master={master} />;
}
