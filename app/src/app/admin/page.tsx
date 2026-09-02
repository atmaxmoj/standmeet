// /admin — root landing redirects to the dashboard overview (a returning owner
// wants to see global status first, not land straight in the public-face editor).

import { redirect } from 'next/navigation';

export default function AdminIndex() {
  redirect('/admin/dashboard');
}
