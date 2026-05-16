"""
Update "Conversation Report" skill prompt to be visitor-focused.

The owner-side summary uses a separate prompt in the Electron client.
"""

from django.db import migrations

NEW_PROMPT = (
    "Generate a concise conversation report from the visitor's perspective "
    "(max 600 words, must fit 1-2 printed pages).\n\n"
    "Structure:\n"
    "1. **Overview** — 2-3 sentences: what the conversation was about and what the visitor learned\n"
    "2. **Key Topics Discussed** — 3-5 bullet points of topics covered\n"
    "3. **Key Takeaways** — 3-5 bullet points of the most important things the visitor learned\n"
    "4. **Next Steps / Recommendations** — if applicable, 2-3 actionable items for the visitor\n\n"
    "Rules:\n"
    "- Write from the visitor's perspective — focus on what was learned and discovered\n"
    "- Do NOT reproduce the full conversation transcript\n"
    '- Write in third person ("The visitor learned that...", "The discussion revealed...")\n'
    "- Be concise — every sentence should add value\n"
    "- Professional tone, suitable for the visitor to share with others"
)


def update_prompt(apps, schema_editor):
    SkillModel = apps.get_model("persistence", "SkillModel")
    SkillModel.objects.filter(name="Conversation Report", is_builtin=True).update(
        prompt=NEW_PROMPT,
    )


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("persistence", "0018_chat_session_summary"),
    ]

    operations = [
        migrations.RunPython(update_prompt, noop),
    ]
