#!/usr/bin/env python3
"""crop_assets.py — 把生成的 contact sheet 裁成媒体资产文件。

    python3 apps/api-go/scripts/mockdata/crop_assets.py

产出（写到 media store，与 DB 行里的 original_storage_key 一一对应）：

    devseed_<key>_portrait_v1.jpg     70 张头像，256×256（用户 31–100）
    devseed_venue_NN.jpg              28 张店面占位图，800×800
    devseed_venue_scene_NN.jpg        12 张仓库自带 ai-scenes 的副本

为什么先落文件再灌 SQL：MEDIA-FILE-001 —— 一行声称 READY 却没有字节的媒体资产，
客户端会画成一个黑圈。SQL 里写 READY 只是声明，字节必须在磁盘上真的存在。

⚠️ 这里的 sheet 是本批 AI 生成的原图（3×3 人脸 / 2×2 店面）。
   用户 2026-10-01 明确「不需要生成」之后就不再生成新的 sheet 了；
   本脚本只负责裁剪**已经生成的那 8 + 8 张**，可重复执行（覆盖写）。
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spec  # noqa: E402

MEDIA_STORE = Path.home() / "Developer/kake-data/media_store"
WORKSPACE = Path("/Users/thanhhuyennguyen/WorkBuddy AI/2026-09-22-18-53-06")
SHEETS = WORKSPACE / "mockdata-gen" / "sheets"

# 人脸 sheet（3×3）。第一张是测试图，文件名前缀和店面测试图撞了 ——
# 靠时间戳区分：11-31-48 是人脸，11-31-53 是店面。已经人工看过确认。
AVATAR_SHEETS = [
    SHEETS / "A_contact_sheet__one_single_sq_2026-09-30T11-31-48.png",
    SHEETS / "Contact_sheet_A2__one_square_i_2026-09-30T11-33-31.png",
    SHEETS / "Contact_sheet_A3__one_square_i_2026-09-30T11-33-32.png",
    SHEETS / "Contact_sheet_A4__one_square_i_2026-09-30T11-33-36.png",
    SHEETS / "Contact_sheet_A5__one_square_i_2026-09-30T11-33-34.png",
    SHEETS / "Contact_sheet_A6__one_square_i_2026-09-30T11-33-31.png",
    SHEETS / "Contact_sheet_A7__one_square_i_2026-09-30T11-33-31.png",
    SHEETS / "Contact_sheet_A8__one_square_i_2026-09-30T11-33-30.png",
]

# 店面 sheet（2×2）
VENUE_SHEETS = [
    SHEETS / "A_contact_sheet__one_single_sq_2026-09-30T11-31-53.png",
    SHEETS / "Cover_sheet_V2__one_square_ima_2026-09-30T11-35-07.png",
    SHEETS / "Cover_sheet_V3__one_square_ima_2026-09-30T11-35-01.png",
    SHEETS / "Cover_sheet_V4__one_square_ima_2026-09-30T11-35-03.png",
    SHEETS / "Cover_sheet_V5__one_square_ima_2026-09-30T11-35-06.png",
    SHEETS / "Cover_sheet_V6__one_square_ima_2026-09-30T11-35-04.png",
    SHEETS / "Cover_sheet_V7__one_square_ima_2026-09-30T11-34-37.png",
    SHEETS / "Cover_sheet_V8__one_square_ima_2026-09-30T11-35-08.png",
]

AI_SCENES = Path.home() / "proxy/apps/mobile/assets/ai-scenes"

# 格子内缩比例：把格子之间那条白缝排掉，否则裁出来的头像会带一道白边。
INSET = 0.045


def cells(sheet: Path, cols: int, rows: int, inset: float = INSET):
    """按 cols×rows 切格子，每格先内缩再取中心正方形。"""
    img = Image.open(sheet).convert("RGB")
    W, H = img.size
    for r in range(rows):
        for c in range(cols):
            x0, x1 = c * W / cols, (c + 1) * W / cols
            y0, y1 = r * H / rows, (r + 1) * H / rows
            dx, dy = (x1 - x0) * inset, (y1 - y0) * inset
            box = (round(x0 + dx), round(y0 + dy), round(x1 - dx), round(y1 - dy))
            cell = img.crop(box)
            side = min(cell.size)
            left = (cell.width - side) // 2
            top = (cell.height - side) // 2
            yield cell.crop((left, top, left + side, top + side))


def main() -> int:
    if not MEDIA_STORE.is_dir():
        print(f"media store 不存在：{MEDIA_STORE}", file=sys.stderr)
        return 1

    # ── 70 张头像 ────────────────────────────────────────────────────────────
    keys = [k for (_n, k, *_r) in spec.EXTRA_USERS]
    faces: list[Image.Image] = []
    for sheet in AVATAR_SHEETS:
        if not sheet.exists():
            print(f"缺 sheet：{sheet}", file=sys.stderr)
            return 1
        faces.extend(cells(sheet, 3, 3))
    if len(faces) < len(keys):
        print(f"人脸只有 {len(faces)} 张，需要 {len(keys)}", file=sys.stderr)
        return 1

    for key, face in zip(keys, faces):
        out = MEDIA_STORE / f"devseed_{key}_portrait_v1.jpg"
        face.resize((256, 256), Image.LANCZOS).save(out, "JPEG", quality=88, optimize=True)

    # ── 28 张店面占位图 ──────────────────────────────────────────────────────
    venues: list[Image.Image] = []
    for sheet in VENUE_SHEETS:
        if not sheet.exists():
            print(f"缺 sheet：{sheet}", file=sys.stderr)
            return 1
        venues.extend(cells(sheet, 2, 2))
    if len(venues) < 28:
        print(f"店面图只有 {len(venues)} 张，需要 28", file=sys.stderr)
        return 1

    for i, photo in enumerate(venues[:28], start=1):
        out = MEDIA_STORE / f"devseed_venue_{i:02d}.jpg"
        photo.resize((800, 800), Image.LANCZOS).save(out, "JPEG", quality=88, optimize=True)

    # ── 12 张 ai-scenes 副本（仓库自带，不重新生成）───────────────────────────
    scenes = sorted(AI_SCENES.glob("*.jpg"))
    if len(scenes) < 12:
        print(f"ai-scenes 只有 {len(scenes)} 张，需要 12", file=sys.stderr)
        return 1
    for i, src in enumerate(scenes[:12], start=1):
        shutil.copyfile(src, MEDIA_STORE / f"devseed_venue_scene_{i:02d}.jpg")

    made = sorted(MEDIA_STORE.glob("devseed_*.jpg"))
    print(f"头像 {len(keys)} 张 / 店面 {len(venues[:28])} 张 / ai-scenes 12 张")
    print(f"media store 里 devseed_*.jpg 共 {len(made)} 个文件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
