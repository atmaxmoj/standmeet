import { z } from 'zod';

export const PageContentSchema = z.object({
  updated_at: z.string(), owner_id: z.string(), hero_prose: z.string(),
  hero_examples: z.array(z.string()),
  insights: z.array(z.object({ id: z.string(), thesis: z.string(), context: z.string(), body: z.string() })),
  projects: z.array(z.object({ id: z.string(), name: z.string(), tagline: z.string(), lines: z.array(z.string()), url: z.string().optional() })),
  where: z.object({ location_line: z.string(), status_prose: z.string(), looking_for: z.array(z.string()), closing: z.string() }),
  contact: z.object({ chat_line: z.string(), email: z.string(), recruiter_prose: z.string(), casual_prose: z.string() }),
});
