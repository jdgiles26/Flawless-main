"""luxyai backend compatibility entry point.

Production startup commands continue to use ``backend.app.main:app``, while
the actual application assembly lives in ``backend.app.application``. This
keeps the deployment contract unchanged while avoiding the entry point file
growing again.
"""

from __future__ import annotations

import sys

from backend.app import application as _application


# Point the compatibility module directly at the real application module.
# Monkeypatches applied to private functions by legacy tests or extension
# code will still operate on the same module object, so no "duplicate
# global state" appears during the migration period.
sys.modules[__name__] = _application
