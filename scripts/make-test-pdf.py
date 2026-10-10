# -*- coding: utf-8 -*-
"""生成一个用于测试 PDF 导入链路的课表 PDF（纯 ASCII，用内置 Helvetica 字体）。
中文需嵌入字体，测试里不重要——解析链路一致，中文场景另外由 OCR 路径覆盖。
"""
import sys

W, H = 612, 792
OPS = []


def text(x, y, s, size=9):
    OPS.append("BT /F1 %g Tf %g %g Td (%s) Tj ET" % (size, x, y, s))


# 表头：星期
DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
for i, d in enumerate(DAYS):
    text(110 + i * 95, 730, d, 10)

# 行首：节次标记。注意 PDF 的 y 轴向上，标记要放在该节内容的上方，
# 所以它用基准 y + 13，而不是减。
for r in range(1, 6):
    text(45, 703 - (r - 1) * 62, 'No.%d' % r, 9)

# 单元格内容：课程名 + 教师 + 地点 + 周次，模拟真实课表的一个格
CELLS = [
    (110, 690, 'Math', 'Zhang', 'A101', '1-16'),
    (205, 690, 'English', 'Li', 'B203', '1-16'),
    (395, 690, 'Physics', 'Wang', 'C305', '1-8'),
    (110, 628, 'Math', 'Zhang', 'A101', '1-16'),
    (300, 628, 'Chemistry', 'Zhao', 'D102', '3-15'),
    (205, 566, 'English', 'Li', 'B203', '1-16'),
    (490, 566, 'PE', 'Sun', 'Gym', '1-16'),
    (110, 504, 'Physics', 'Wang', 'C305', '1-8'),
    (300, 504, 'Math', 'Zhang', 'A101', '1-16'),
    (205, 442, 'Chemistry', 'Zhao', 'D102', '3-15'),
]
for x, y, name, teacher, place, weeks in CELLS:
    text(x, y, name)
    text(x, y - 13, teacher)
    text(x, y - 26, place)
    text(x, y - 39, weeks)

CONTENT = "\n".join(OPS).encode('latin-1')

OBJS = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
     "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>" % (W, H)).encode('latin-1'),
    b"<< /Length " + str(len(CONTENT)).encode() + b" >>\nstream\n" + CONTENT + b"\nendstream",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]

out = bytearray(b"%PDF-1.4\n")
offsets = []
for i, body in enumerate(OBJS, start=1):
    offsets.append(len(out))
    out += str(i).encode() + b" 0 obj\n" + body + b"\nendobj\n"

xref_at = len(out)
out += b"xref\n0 " + str(len(OBJS) + 1).encode() + b"\n"
out += b"0000000000 65535 f \n"
for off in offsets:
    out += ("%010d 00000 n \n" % off).encode()
out += b"trailer\n<< /Size " + str(len(OBJS) + 1).encode() + b" /Root 1 0 R >>\n"
out += b"startxref\n" + str(xref_at).encode() + b"\n%%EOF\n"

path = sys.argv[1] if len(sys.argv) > 1 else 'test-timetable.pdf'
with open(path, 'wb') as f:
    f.write(bytes(out))
print("已生成 %s，%d 字节" % (path, len(out)))
