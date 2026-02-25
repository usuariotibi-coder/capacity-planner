import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext as _


class ComplexityPasswordValidator:
    """
    Require explicit complexity rules expected by frontend security hints.
    """

    def validate(self, password, user=None):
        if not password:
            return

        missing_rules: list[str] = []
        if not re.search(r"[A-Z]", password):
            missing_rules.append(_("at least one uppercase letter"))
        if not re.search(r"[a-z]", password):
            missing_rules.append(_("at least one lowercase letter"))
        if not re.search(r"\d", password):
            missing_rules.append(_("at least one number"))
        if not re.search(r"[^a-zA-Z0-9]", password):
            missing_rules.append(_("at least one special character"))

        if missing_rules:
            raise ValidationError(
                _("Password must include %(rules)s."),
                params={"rules": ", ".join(missing_rules)},
            )

    def get_help_text(self):
        return _(
            "Your password must include at least one uppercase letter, one lowercase letter, one number, and one special character."
        )
