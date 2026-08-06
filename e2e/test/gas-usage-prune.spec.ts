// gas-usage-prune.spec.ts —— the tank must not refill itself.
//
// `inference_usage` is a 7-day table: the dashboard only ever looks back 7 days, so old rows are
// pruned. But gas is derived by summing those rows since the tank was last filled — there is no
// counter column. Prune a metered row that a tank is still accountable for and the fuel it spent
// comes back. A visitor who ran the tank dry could then keep going, for free, forever.
//
// So the prune keeps exactly the rows a live tank still needs, and drops everything else. The two
// halves are asserted together: a kept row that isn't needed is a leak, and a dropped row that is
// needed is free fuel.
//
// Old rows cannot be made through any API — there is no "set the clock back" endpoint, and there
// should not be. They are inserted directly, and the prune is triggered the only way it happens in
// production: the process starts.

import { test, expect } from '@playwright/test';
import { claim, login as loginAPI } from '@/fixtures/admin';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';
import { createProvider, providerByID, setProviderGas } from '@/fixtures/providers';

const OWNER = {
  email: 'prune@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'pruneowner',
  fullName: 'Prune Owner',
};

test.describe.configure({ mode: 'serial' });

test('the prune keeps what a live tank is accountable for, and drops the rest', async ({
  playwright,
}) => {
  test.setTimeout(120_000); // a backend restart is part of the test

  resetInstance();
  const api = await playwright.request.newContext();
  await claim(api, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);

  const tank = await createProvider(api, csrf, {
    label: 'accountable', provider: 'anthropic', model: 'mock-model-prune',
  });
  const idle = await createProvider(api, csrf, {
    label: 'no-gauge', provider: 'anthropic', model: 'mock-model-idle',
  });
  const ownerID = querySQL(`SELECT id FROM owners WHERE email = '${OWNER.email}'`);
  // Filling moves the accounting start to NOW, so a row dated 8 days ago would fall outside the
  // period and be droppable. Backdate the fill instead: an owner who filled the tank a month ago
  // and gets a trickle of visitors is the whole reason this rule exists.
  await setProviderGas(api, csrf, tank.id, 500_000);
  execSQL(`UPDATE owner_providers SET gas_filled_at = now() - interval '30 days'
           WHERE id = '${tank.id}'`);
  // 1. metered, on the live tank, inside the current period, but older than 7 days.
  await insertUsage(ownerID, tank.id, true, '8 days', 'kept');
  // 2. metered, but on a provider with no fuel in it — nothing is summing these.
  await insertUsage(ownerID, idle.id, true, '8 days', 'idle-tank');
  // 3. not metered at all (byoai-era row / an unmetered role) — pure dashboard history.
  await insertUsage(ownerID, tank.id, false, '8 days', 'unmetered');
  // 4. inside the 7-day window — the dashboard still shows it, metered or not.
  await insertUsage(ownerID, tank.id, false, '2 days', 'recent');

  restartBackend();

  expect(usageCount(ownerID, 'kept'), 'the live tank still needs it').toBe(1);
  expect(usageCount(ownerID, 'recent'), 'inside the dashboard window').toBe(1);
  expect(usageCount(ownerID, 'idle-tank'), 'no tank is summing it — it is just old').toBe(0);
  expect(usageCount(ownerID, 'unmetered'), 'never counted against any tank').toBe(0);

  // And the tank still reads as spent: the arithmetic that kept the row is the same one the gauge
  // reports, so a prune that got this wrong would show up here as fuel that grew back.
  const after = await providerByID(api, tank.id);
  expect(after.gas_remaining, 'the 8-day-old spend is still charged').toBe(500_000 - 300);

  await api.dispose();
});

// insertUsage —— one usage row, dated into the past. `model` doubles as the row's label so each
// assertion can name exactly the row it is about.
async function insertUsage(
  ownerID: string, providerID: string, metered: boolean, age: string, label: string,
): Promise<void> {
  execSQL(
    `INSERT INTO inference_usage
       (owner_id, model, input_tokens, output_tokens, provider_id, metered, created_at)
     VALUES ('${ownerID}', '${label}', 100, 200, '${providerID}', ${metered},
             now() - interval '${age}')`,
  );
}

function usageCount(ownerID: string, label: string): number {
  return Number(querySQL(
    `SELECT count(*) FROM inference_usage WHERE owner_id = '${ownerID}' AND model = '${label}'`,
  ));
}
