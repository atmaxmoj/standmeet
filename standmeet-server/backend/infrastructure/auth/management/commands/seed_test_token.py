from django.core.management.base import BaseCommand

from infrastructure.auth.owner_token import OwnerToken

FIXED_TOKEN = "smo_e2e_test_token_fixed"


class Command(BaseCommand):
    help = "Seed a fixed owner token for E2E testing"

    def handle(self, *args, **options):
        if not OwnerToken.objects.filter(token=FIXED_TOKEN).exists():
            OwnerToken.objects.create(token=FIXED_TOKEN, label="e2e-test")
            self.stdout.write(f"Seeded test token: {FIXED_TOKEN}")
        else:
            self.stdout.write(f"Test token already exists: {FIXED_TOKEN}")
