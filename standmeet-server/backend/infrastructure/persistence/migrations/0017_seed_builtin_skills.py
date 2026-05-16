"""
Seed built-in skills via data migration.

Runs automatically as part of `manage.py migrate`.
Uses update_or_create so it's safe even if skills already exist from the old
management command.
"""

from django.db import migrations

BUILTIN_SKILLS = [
    {
        "name": "Code Review",
        "description": "AI helps review code, suggest improvements",
        "prompt": (
            "You are an expert code reviewer. When the visitor shares code or asks about code quality, "
            "provide constructive feedback on readability, performance, security, and best practices. "
            "Reference the owner's coding experience and projects when relevant."
        ),
    },
    {
        "name": "Frontend Design",
        "description": "AI discusses UI/UX, frontend architecture",
        "prompt": (
            "You are a frontend design consultant. Discuss UI/UX principles, component architecture, "
            "responsive design, accessibility, and modern frontend patterns. "
            "Reference the owner's frontend experience and projects when relevant."
        ),
    },
    {
        "name": "Resume / Portfolio",
        "description": "AI showcases owner's resume and portfolio",
        "prompt": (
            "You are presenting the owner's professional profile. Proactively highlight their skills, "
            "experience, projects, and achievements. Answer questions about their background thoroughly "
            "and enthusiastically, as if you were their personal career advocate."
        ),
    },
    {
        "name": "Technical Interview",
        "description": "AI conducts technical Q&A",
        "prompt": (
            "You are a technical interviewer. Ask the visitor technical questions appropriate to their "
            "stated experience level. Evaluate their answers, provide hints when they're stuck, and "
            "give constructive feedback. Draw from the owner's areas of expertise for question topics."
        ),
    },
    {
        "name": "Conversation Report",
        "description": "Allow visitors to export conversation as PDF report with AI summary",
        "prompt": (
            "Generate a concise conversation report (max 600 words, must fit 1-2 printed pages).\n\n"
            "Structure:\n"
            "1. **Overview** — 2-3 sentences summarizing the conversation purpose and outcome\n"
            "2. **Key Topics Discussed** — 3-5 bullet points\n"
            "3. **Key Takeaways** — 3-5 bullet points of the most important findings or conclusions\n"
            "4. **Next Steps / Recommendations** — if applicable, 2-3 actionable items\n\n"
            "Rules:\n"
            "- Do NOT reproduce the full conversation transcript\n"
            '- Write in third person ("The visitor asked about...", "The discussion covered...")\n'
            "- Be concise — every sentence should add value\n"
            "- Professional tone, suitable for sharing"
        ),
    },
]


def seed_builtin_skills(apps, schema_editor):
    SkillModel = apps.get_model("persistence", "SkillModel")
    for skill_data in BUILTIN_SKILLS:
        SkillModel.objects.update_or_create(
            name=skill_data["name"],
            defaults={
                "description": skill_data["description"],
                "prompt": skill_data["prompt"],
                "is_builtin": True,
            },
        )


def unseed_builtin_skills(apps, schema_editor):
    SkillModel = apps.get_model("persistence", "SkillModel")
    SkillModel.objects.filter(
        name__in=[s["name"] for s in BUILTIN_SKILLS],
        is_builtin=True,
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("persistence", "0016_chatlog_sources"),
    ]

    operations = [
        migrations.RunPython(seed_builtin_skills, unseed_builtin_skills),
    ]
