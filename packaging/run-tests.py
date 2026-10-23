"""Runs the backend tests; on failure, prints them as GitHub annotations too (readable without logs)."""
import io
import sys
import unittest

buf = io.StringIO()
suite = unittest.defaultTestLoader.discover("tests")
res = unittest.TextTestRunner(stream=buf, verbosity=2).run(suite)
out = buf.getvalue()
sys.stdout.write(out)
if not res.wasSuccessful():
    for test, tb in res.failures + res.errors:
        msg = ("%s\n%s" % (test, tb[-1500:])).replace("%", "%25").replace("\r", "").replace("\n", "%0A")
        print("::error title=%s::%s" % (str(test).split(" ")[0], msg))
    sys.exit(1)
