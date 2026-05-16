from django.conf import settings
from django.core.management.base import BaseCommand

from infrastructure.auth.jwt_auth import generate_owner_jwt
from infrastructure.auth.owner_token import OwnerToken


class Command(BaseCommand):
    help = "Create a new owner API token (JWT or legacy)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--label",
            default="default",
            help="Label for the token (e.g. 'claude-code')",
        )
        parser.add_argument(
            "--jwt",
            action="store_true",
            help="Generate a JWT token instead of a legacy smo_ token",
        )
        parser.add_argument(
            "--expires-in-days",
            type=int,
            default=30,
            help="JWT expiration in days (default: 30)",
        )

    def handle(self, *args, **options):
        label = options["label"]

        if options["jwt"]:
            if settings.SECRET_KEY == "django-insecure-dev-only-change-in-production":
                self.stderr.write(
                    self.style.WARNING(
                        "WARNING: Using insecure default SECRET_KEY. "
                        "Set DJANGO_SECRET_KEY env var for production!"
                    )
                )

            days = options["expires_in_days"]
            token = generate_owner_jwt(label=label, expires_in_days=days)
            self.stdout.write("\nOwner JWT created successfully!")
            self.stdout.write(f"  Label:   {label}")
            self.stdout.write(f"  Expires: {days} days")
            self.stdout.write(f"  Token:   {token}")
            self.stdout.write("\nStore this token securely — it won't be shown again.")
        else:
            token_obj = OwnerToken.generate(label=label)
            self.stdout.write("\nOwner token created successfully!")
            self.stdout.write(f"  Label: {token_obj.label}")
            self.stdout.write(f"  Token: {token_obj.token}")
            self.stdout.write("\nStore this token securely — it won't be shown again.")
