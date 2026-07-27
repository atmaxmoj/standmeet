-- name: GetPageContent :one
SELECT owner_id, hero_prose, hero_examples, insights, projects,
       where_section, contact, updated_at
FROM page_content
WHERE owner_id = $1;

-- name: UpsertPageContent :one
INSERT INTO page_content (
    owner_id, hero_prose, hero_examples, insights, projects,
    where_section, contact, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
ON CONFLICT (owner_id) DO UPDATE SET
    hero_prose    = EXCLUDED.hero_prose,
    hero_examples = EXCLUDED.hero_examples,
    insights      = EXCLUDED.insights,
    projects      = EXCLUDED.projects,
    where_section = EXCLUDED.where_section,
    contact       = EXCLUDED.contact,
    updated_at    = now()
RETURNING owner_id, hero_prose, hero_examples, insights, projects,
          where_section, contact, updated_at;
