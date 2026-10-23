"""Entry point for the packaged app (.exe, .app, AppImage)."""
import os
import sys


def _clean_child_env():
    # PyInstaller points LD_LIBRARY_PATH at its own bundled libraries. Programs we start
    # (Chrome, xdg-open, lp, fc-list) must see the system's libraries instead.
    if sys.platform.startswith("linux") and getattr(sys, "frozen", False):
        for var in ("LD_LIBRARY_PATH",):
            orig = os.environ.get(var + "_ORIG")
            if orig is not None:
                os.environ[var] = orig
            else:
                os.environ.pop(var, None)


if __name__ == "__main__":
    _clean_child_env()
    from zebraapp.server import main
    try:
        # macOS used to pass -psn_… when started from Finder
        main([a for a in sys.argv[1:] if not a.startswith("-psn_")])
    except SystemExit:
        raise
    except BaseException:
        # no console in the packaged app: leave the error where a user can find it
        import traceback
        from zebraapp.storage import data_dir
        with open(data_dir() / "zebraapp-error.log", "a", encoding="utf-8") as f:
            traceback.print_exc(file=f)
        raise
