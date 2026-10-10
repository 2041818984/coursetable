# -*- coding: utf-8 -*-
"""生成一张仿真的中文课表图片，用于验证 OCR 链路。

画成「节次列 + 星期表头 + 多行课程格」的样式，
和教务系统截图/拍照出来的课表结构一致。
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'test-ocr-timetable.png')

W, H = 1560, 940
BG = (255, 255, 255)
LINE = (40, 40, 40)
TEXT = (10, 10, 10)

PAD_X, PAD_Y = 20, 20
HEAD_H = 78          # 表头高度
ROW_H = 196          # 每行高度
N_ROWS = 4
PERIOD_W = 170       # 节次列宽

DAYS = ['星期一', '星期二', '星期三', '星期四', '星期五']
DAY_W = (W - PAD_X * 2 - PERIOD_W) / len(DAYS)

# 每行：节次标记 + {列序号: 课程格内容}
ROWS = [
    ('第1节', {0: '高等数学A\n张三\n教三-301\n1-16周'}),
    ('第2节', {1: '大学英语\n李四\n外语楼-205\n1-8周'}),
    ('第3节', {2: '数据结构\n王五\n计算机楼-101\n1-16周'}),
    ('第4节', {3: '体育\n赵六\n体育馆\n9-16周'}),
]


def font(size):
    for name in ('msyh.ttc', 'simhei.ttf', 'simsun.ttc'):
        p = os.path.join(r'C:\Windows\Fonts', name)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    raise SystemExit('找不到中文字体')


img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

f_head = font(34)
f_period = font(28)
f_cell = font(30)

# 表头
d.text((PAD_X + PERIOD_W / 2, PAD_Y + HEAD_H / 2), '节次',
       font=f_head, fill=TEXT, anchor='mm')
for i, day in enumerate(DAYS):
    cx = PAD_X + PERIOD_W + DAY_W * (i + 0.5)
    d.text((cx, PAD_Y + HEAD_H / 2), day, font=f_head, fill=TEXT, anchor='mm')

# 课程格
for r, (period, cells) in enumerate(ROWS):
    for col, content in cells.items():
        cx = PAD_X + PERIOD_W + DAY_W * (col + 0.5)
        cy = PAD_Y + HEAD_H + ROW_H * r + ROW_H / 2
        d.multiline_text((cx, cy), content, font=f_cell,
                         fill=TEXT, anchor='mm', align='center', spacing=10)

# 网格线（先画内容再加线，线更清晰）
x0, y0 = PAD_X, PAD_Y
x1, y1 = W - PAD_X, PAD_Y + HEAD_H + ROW_H * N_ROWS

d.rectangle([x0, y0, x1, y1], outline=LINE, width=3)
d.line([x0, y0 + HEAD_H, x1, y0 + HEAD_H], fill=LINE, width=3)
d.line([x0 + PERIOD_W, y0, x0 + PERIOD_W, y1], fill=LINE, width=3)
for i in range(1, len(DAYS)):
    x = x0 + PERIOD_W + DAY_W * i
    d.line([x, y0, x, y1], fill=LINE, width=3)
for r in range(1, N_ROWS):
    y = y0 + HEAD_H + ROW_H * r
    d.line([x0, y, x1, y], fill=LINE, width=3)

# 节次文字（加完线再画，避免被线压住）
for r, (period, _) in enumerate(ROWS):
    cy = y0 + HEAD_H + ROW_H * r + ROW_H / 2
    d.text((x0 + PERIOD_W / 2, cy), period, font=f_period, fill=TEXT, anchor='mm')

img.save(OUT, 'PNG')
print('已生成 %s  (%dx%d, %d 字节)' % (OUT, W, H, os.path.getsize(OUT)))


# ---------- 再生成一份「抹掉表格线」的版本 ----------
# App 里由 OcrImport.stripGridLines() 在 canvas 上完成同样的事；
# 这里提前算好，好让 Node 侧的自测能直接喂进去（Node 没有 canvas）。
CLEAN = os.path.join(HERE, 'test-ocr-timetable-clean.png')
px = img.load()
out = img.copy()
op = out.load()

for y in range(H):
    dark = sum(1 for x in range(W) if sum(px[x, y]) / 3 < 170)
    if dark >= W * 0.6:
        for dy in (-1, 0, 1):
            yy = y + dy
            if 0 <= yy < H:
                for x in range(W):
                    op[x, yy] = (255, 255, 255)

for x in range(W):
    dark = sum(1 for y in range(H) if sum(px[x, y]) / 3 < 170)
    if dark >= H * 0.6:
        for dx in (-1, 0, 1):
            xx = x + dx
            if 0 <= xx < W:
                for y in range(H):
                    op[xx, y] = (255, 255, 255)

out.save(CLEAN, 'PNG')
print('已生成 %s  (抹线版, %d 字节)' % (CLEAN, os.path.getsize(CLEAN)))

