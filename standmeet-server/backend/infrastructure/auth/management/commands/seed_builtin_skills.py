"""
Seed built-in skills.

Idempotent — uses update_or_create by name.
"""

from django.core.management.base import BaseCommand

from infrastructure.persistence.models import SkillModel

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
        ),
    },
]


class Command(BaseCommand):
    help = "Seed built-in skills (idempotent)"

    def handle(self, *args, **options):
        for skill_data in BUILTIN_SKILLS:
            _, created = SkillModel.objects.update_or_create(
                name=skill_data["name"],
                defaults={
                    "description": skill_data["description"],
                    "prompt": skill_data["prompt"],
                    "is_builtin": True,
                },
            )
            status = "created" if created else "updated"
            self.stdout.write(f"  Skill '{skill_data['name']}' — {status}")

        self.stdout.write(self.style.SUCCESS("Built-in skills seeded"))
