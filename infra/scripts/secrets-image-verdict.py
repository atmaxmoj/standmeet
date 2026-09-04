#!/usr/bin/env python3
"""secrets-image-verdict —— one scan, two judgments.

The caller (`make secrets-image`) unpacks the image rootfs into a temp directory, **plants a
freshly generated canary in the image's own WorkingDir**, then scans the whole tree. This script
reads that report and requires:

  1. The canary **must be in it**. Not there = the scan didn't cover the directory we ourselves
     COPY'd in — maybe the exclusion rules are too broad, maybe unpacking failed. In that case
     "no leaks found" is a lie about the world, and it looks identical to a real pass.
  2. **Nothing other than the canary**. Anything else = there really is something in this image;
     don't push.

Why fold the self-test and the real scan into one: scanning the 145 MB builder image once takes
30 seconds, twice takes a minute, and the image doesn't change between the two passes. One scan
answers both "can you see it" and "is anything inside" at once.
"""

import json
import os
import sys


def main() -> int:
    report_path, root, image, canary_rel = sys.argv[1:5]
    canary_abs = root + canary_rel

    try:
        with open(report_path, encoding="utf-8") as fh:
            findings = json.load(fh)
    except (OSError, json.JSONDecodeError):
        findings = []

    canary = [f for f in findings if os.path.abspath(f["File"]) == os.path.abspath(canary_abs)]
    real = [f for f in findings if os.path.abspath(f["File"]) != os.path.abspath(canary_abs)]

    if not canary:
        print(f"secrets-image: SELF-TEST FAILED on {image} — a planted key in {canary_rel}")
        print("               was not reported. This scan is not covering the image's own")
        print("               content, so 'clean' would mean nothing. Check the tar excludes.")
        return 2

    if real:
        print(f"secrets-image: secrets inside {image} — do NOT push. Where:")
        for f in real:
            print(f"  {f['RuleID']:<20} {f['File'].replace(root, '')}:{f['StartLine']}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
