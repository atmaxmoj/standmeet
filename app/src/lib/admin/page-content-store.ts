// page-content-store —— resource store for the /api/admin/page server baseline.
// The baseline for the admin /page section's edit form; mutate() syncs the
// cache after a successful PUT so the next mount doesn't need to re-GET.
//
// Same shape as sessionStore / codesStore: a single fetcher, {status,data,error}
// unified by the [[create-resource-store]] factory.

import { adminAPI, type AdminPage } from '@/lib/api/admin';
import { AdminPageSchema } from '@/lib/api/public-schemas';
import { createResourceStore } from '@/lib/state/create-resource-store';

export const pageContentStore = createResourceStore<AdminPage>({
  name: 'page-content',
  fetcher: () => adminAPI.get('/page', AdminPageSchema),
});
