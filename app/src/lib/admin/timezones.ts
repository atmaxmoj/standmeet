// timezones —— IANA timezone options for the booking-policy dropdown.
//
// Backed by @vvo/tzdb (a curated tzdb snapshot) rather than a hand-kept list:
// it gives every IANA zone a human label with its *current* UTC offset (DST
// aware), e.g. "-04:00 Eastern Time - New York City, …". The <option> value is
// always the bare IANA name (what we store); the label is just for the menu.

import { getTimeZones } from '@vvo/tzdb';

export interface TimezoneOption {
  value: string; // IANA name, e.g. "America/New_York" — what gets saved
  label: string; // human menu text, e.g. "-04:00 Eastern Time - New York City, …"
}

// timezoneOptions —— the full option list (offset-ordered, as @vvo/tzdb returns
// them). `current` is guaranteed present even if it's a legacy/aliased name the
// snapshot doesn't surface as a primary zone, so a saved value never drops off.
export function timezoneOptions(current: string): TimezoneOption[] {
  const zones = getTimeZones();
  const opts = zones.map((z) => ({ value: z.name, label: z.currentTimeFormat }));
  if (current !== '' && !zones.some((z) => z.name === current)) {
    return [{ value: current, label: current }, ...opts];
  }
  return opts;
}
