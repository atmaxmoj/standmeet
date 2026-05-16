"""
Update "Conversation Report" skill prompt with better Markdown formatting instructions.
"""

from django.db import migrations

NEW_PROMPT = (
    "Generate a polished conversation report (max 600 words, 1-2 printed pages).\n\n"
    "Use proper Markdown formatting — the output will be rendered with a full Markdown engine "
    "(headings, bold, lists, tables, blockquotes, etc. all work).\n\n"
    "## Required sections:\n\n"
    "### Overview\n"
    "2-3 sentences summarizing the conversation topic and outcome.\n\n"
    "### Key Topics Discussed\n"
    "3-5 bullet points. Each bullet should be a concise sentence, not just a keyword.\n\n"
    "### Key Takeaways\n"
    "3-5 bullet points of the most important findings or conclusions.\n\n"
    "### Next Steps\n"
    "If applicable, 2-3 actionable recommendations. Omit this section if nothing actionable.\n\n"
    "## Formatting rules:\n"
    "- Use `##` for section headings (NOT `#` or `###`)\n"
    "- Use `-` for bullet points\n"
    "- Use **bold** for emphasis on key terms\n"
    "- Keep paragraphs short (2-3 sentences max)\n"
    "- Do NOT reproduce the conversation transcript\n"
    '- Write in third person ("The visitor asked about...", "The discussion covered...")\n'
    "- Professional tone, suitable for sharing"
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
        ("persistence", "0019_update_report_skill_prompt"),
    ]

    operations = [
        migrations.RunPython(update_prompt, noop),
    ]
