#!/usr/bin/env python3
"""secrets-image-verdict —— 一次扫描，两个判断。

调用方（`make secrets-image`）把镜像 rootfs 解到一个临时目录，**在这个镜像自己的
WorkingDir 里种一个现生成的诱饵**，然后整棵树扫一遍。这个脚本读那份报告，要求：

  1. 诱饵**必须在里面**。不在 = 扫描没覆盖到我们自己 COPY 进去的那个目录 ——
     可能是排除规则写宽了，可能是解包失败。那种情况下的「no leaks found」是一句
     关于世界的假话，而它跟真的通过长得一模一样。
  2. **除了诱饵之外什么都没有**。有别的 = 这个镜像里真有东西，不许推。

为什么把自证和真扫合成一次：145 MB 的 builder 镜像扫一遍 30 秒，扫两遍就是一分钟，
而两遍之间镜像并没有变。一次扫描能同时回答「你看得见吗」和「里面有什么吗」。
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
