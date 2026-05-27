// page-content-store —— /api/admin/page server baseline 的 resource store。
// admin /page section 编辑表单的 baseline；mutate() 在 PUT 成功后同步缓存
// 让下一次 mount 不必重新 GET。
//
// 跟 sessionStore / codesStore 同形状：单一 fetcher，{status,data,error}
// 由 [[create-resource-store]] 工厂统一形态。

import { adminAPI, type PageContent } from '@/lib/api/admin';
import { PageContentSchema } from '@/lib/api/public-schemas';
import { createResourceStore } from '@/lib/state/create-resource-store';

export const pageContentStore = createResourceStore<PageContent>({
  name: 'page-content',
  fetcher: () => adminAPI.get('/page', PageContentSchema),
});
