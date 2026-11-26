# -*- coding: utf-8 -*-
"""Apply the review fixes to the TwoPoles design document.

Reads the original from artifacts/, writes a revised copy to the workspace root
(which the sandbox identity can write). The original is left untouched.
"""
import io
import re
import shutil
from pathlib import Path

from docx import Document
from docx.shared import Cm
from docx.oxml.ns import qn
from lxml import etree
from PIL import Image

ROOT = Path(r'D:\桌面\project\project')
SRC = ROOT / 'artifacts' / 'fitness-design' / '两仪·TwoPoles_项目需求分析与概要设计文档.docx'
OUT = ROOT / '两仪·TwoPoles_项目需求分析与概要设计文档_修订版.docx'
BACKUP = ROOT / '两仪·TwoPoles_项目需求分析与概要设计文档_原始备份.docx'
ASSETS = ROOT / 'artifacts' / 'fitness-design' / 'assets'

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W,
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

log = []


def replace_para(p, old, new, label=''):
    """Replace old with new inside one paragraph, preserving the first run's format."""
    if old not in p.text:
        return False
    if len(p.runs) == 1:
        p.runs[0].text = p.runs[0].text.replace(old, new)
    else:
        # Simple multi-run case: put the entire new text in the first run and blank the rest.
        full = p.text.replace(old, new)
        first = True
        for r in p.runs:
            if first:
                r.text = full
                first = False
            else:
                r.text = ''
    log.append(f'OK  {label}: {old[:35]} -> {new[:35]}')
    return True


def replace_cell(cell, old, new, label=''):
    for p in cell.paragraphs:
        if replace_para(p, old, new, label):
            return True
    return False


def set_run_text_by_contains(p, needle, new):
    for r in p.runs:
        if needle in r.text:
            r.text = r.text.replace(needle, new)
            return True
    return False


def heading3_paragraphs(doc):
    out = []
    for p in doc.paragraphs:
        if re.match(r'^\d+\.\d+\.\d+\s', p.text.strip()):
            out.append(p)
    return out


def clean_heading_ppr(p):
    ppr = p._p.find(qn('w:pPr'))
    if ppr is None:
        return
    for tag in ('w:ind', 'w:spacing', 'w:jc'):
        for el in ppr.findall(qn(tag)):
            ppr.remove(el)


def main():
    shutil.copy2(SRC, BACKUP)
    doc = Document(SRC)

    # ---- 1. Content fixes -------------------------------------------------
    ps = doc.paragraphs
    set_run_text_by_contains(ps[3], '2026年10月17日', '2026年10月18日')
    log.append('OK  封面日期: 2026年10月17日 -> 2026年10月18日')
    replace_para(ps[175], '具体姓名与学号在封面补充，不预设实际开工日期。',
                 '姓名与学号见封面，不预设实际开工日期。', '项目计划残留句')
    replace_para(ps[177], '不影响F01～F20为前提',
                 '不影响F01～F12、F17～F20为前提', '风险控制范围')
    replace_para(ps[180], '完整实现F01～F20',
                 '完整实现F01～F12、F17～F20', '预期成果范围')
    replace_para(ps[71], '负责账号、成年范围确认、共同档案和运动员扩展档案',
                 '负责账号、年龄与适用范围确认、共同档案和运动员扩展档案', '年龄口径')
    set_run_text_by_contains(ps[156], '6.1.1 运动员模式首页', '6.1.1 运动员模式训练台')
    log.append('OK  6.1.1 标题: 首页 -> 训练台')
    replace_para(ps[163], '与是否已校机位在界面上明确标注',
                 '与机位锁定状态在界面上明确标注', '6.1.2 校准标注')
    replace_para(ps[58], 'SQLite不支持enum、jsonb与数组列',
                 'SQLite没有enum、jsonb与数组类型', 'SQLite 类型表述')

    # 1.3 user table: drop "成年"
    t1 = doc.tables[1]
    replace_cell(t1.cell(2, 1), '成年校队或业余竞技运动员',
                 '校队或业余竞技运动员', '1.3 用户表年龄')

    # 1.3 comparison table: drop target date + weight trend; keep pace
    t2 = doc.tables[2]
    replace_cell(t2.cell(1, 2), '专项、训练经验、周期阶段、目标日期、既有计划；可录入体重用于个人趋势',
                 '专项、训练经验、周期阶段、既有计划', '1.3 对比表去目标日期/体重')

    # F11 covers the pace-range output that the comparison table and screenshot show.
    t5 = doc.tables[5]
    replace_cell(t5.cell(11, 2), '展示计划完成、训练趋势、饮食记录完整度及依据',
                 '展示计划完成、训练趋势、建议配速区间、饮食记录完整度及依据', 'F11 配速')

    # 3.2 module table: F18 belongs to M4 only
    t7 = doc.tables[7]
    replace_cell(t7.cell(3, 2), 'F05、F17～F19、F21', 'F05、F17、F19、F21', 'M3 F18 去重')

    # 5.2 data table: Food appears once
    t9 = doc.tables[9]
    replace_cell(t9.cell(7, 0), 'Food / Meal / MealItem', 'Meal / MealItem', '5.2 Food 去重')

    # 4.6 report module covers pace comparison
    replace_para(ps[116], '聚合计划和实际训练、负荷趋势与饮食记录完整度',
                 '聚合计划和实际训练、负荷趋势、跑步配速对比与饮食记录完整度', '4.6.1 配速')
    replace_para(ps[120], '个人周报与月报、计划实际对照、交叉分析条目',
                 '个人周报与月报、计划实际对照、配速区间对照、交叉分析条目', '4.6.3 配速')

    # Reference [5] needs a citation; add it to the population sentence in 1.1.
    replace_para(ps[6], '面向12岁及以上的普通健身者及校队、业余竞技运动员。',
                 '面向12岁及以上的普通健身者及校队、业余竞技运动员[5]。', '引用[5]')

    # 其它 -> 其他 (2 places), and unify 0至10 -> 0～10, without flattening runs.
    n_other = n_range = 0
    for p in doc.paragraphs:
        for r in p.runs:
            if '其它' in r.text:
                r.text = r.text.replace('其它', '其他')
                n_other += 1
            if '0至10' in r.text:
                r.text = r.text.replace('0至10', '0～10')
                n_range += 1
    log.append(f'OK  其它→其他 runs={n_other}, 0至10→0～10 runs={n_range}')

    # ---- 2. Core properties ----------------------------------------------
    cp = doc.core_properties
    cp.title = '两仪·TwoPoles 项目需求分析与概要设计'
    cp.subject = '程序设计综合实验项目需求分析与概要设计'
    cp.author = '彭鑫阳、杨竞航、黎一辉'
    cp.last_modified_by = '彭鑫阳'
    cp.keywords = '双模式健身、运动与饮食协同、MediaPipe、FastAPI、Vue、SQLite'
    cp.comments = '两仪·TwoPoles 课程项目设计文档'
    cp.category = '课程项目'

    # ---- 3. Split the image out of the 6.1.1 heading paragraph -----------
    p156 = ps[156]
    p157 = ps[157]
    drawing_runs = [r for r in p156.runs if r._r.findall('.//' + qn('w:drawing'))]
    if len(drawing_runs) == 1:
        run_el = drawing_runs[0]._r
        p156._p.remove(run_el)
        p157._p.append(run_el)
        log.append('OK  6.1.1 图片从标题段落拆出')
    else:
        log.append(f'WARN 6.1.1 drawing runs={len(drawing_runs)}')

    # The empty image paragraph should sit tight against the caption.
    p157.paragraph_format.space_before = Cm(0)
    p157.paragraph_format.space_after = Cm(0)
    p157.paragraph_format.keep_with_next = True
    p157.alignment = 1  # center

    # ---- 4. Restore Course Heading 3 on all level-3 headings -------------
    h3s = heading3_paragraphs(doc)
    log.append(f'level-3 headings found: {len(h3s)}')
    for p in h3s:
        p.style = doc.styles['Course Heading 3']
        clean_heading_ppr(p)
        p.paragraph_format.keep_with_next = True
        p.paragraph_format.page_break_before = p.paragraph_format.page_break_before
    log.append(f'OK  set Course Heading 3 on {len(h3s)} paragraphs')

    # Let 6.1.1 and 6.1.3 flow instead of forcing a mostly empty page.
    for p in h3s:
        if p.text.strip().startswith(('6.1.1 ', '6.1.3 ')):
            p.paragraph_format.page_break_before = False
            log.append(f'OK  remove page break before {p.text.strip()[:12]}')

    # Chapter 3 otherwise starts on a page containing only 2.4(4)(5).
    for p in doc.paragraphs:
        if p.text.strip() == '3. 系统概要设计':
            p.paragraph_format.page_break_before = False
            log.append('OK  remove page break before 3. 系统概要设计')
            break

    # Let 6.2 flow after 6.1.4; the table must not share a page with the screenshots.
    for p in doc.paragraphs:
        if p.text.strip() == '6.2 外部接口':
            p.paragraph_format.page_break_before = False
            log.append('OK  no forced page break before 6.2 外部接口')
            break

    # ---- 5. Replace stale UI screenshots ---------------------------------
    # Map rId -> new image file and display width.
    replacements = {
        'rId17': (ASSETS / 'ui-athlete.png', 15.0),
        'rId20': (ASSETS / 'ui-mobile.jpeg', 3.66),
    }
    for rid, (path, width_cm) in replacements.items():
        part = doc.part.rels[rid].target_part
        if path.suffix.lower() in ('.jpg', '.jpeg'):
            im = Image.open(path).convert('RGB')
            buf = io.BytesIO()
            im.save(buf, format='PNG')
            part._blob = buf.getvalue()
        else:
            part._blob = path.read_bytes()
        log.append(f'OK  replaced {rid} with {path.name}')

    # Resize the five section-6 screenshots; diagrams stay at 16.1 cm.
    ui_widths = {'rId16': 15.0, 'rId17': 15.0, 'rId18': 15.0, 'rId19': 15.0, 'rId20': 3.66}
    for sh in doc.inline_shapes:
        blip = sh._inline.find('.//' + qn('a:blip'))
        rid = blip.get(qn('r:embed')) if blip is not None else None
        if rid not in ui_widths:
            continue
        # Get real pixel dimensions from the current part blob.
        data = doc.part.rels[rid].target_part.blob
        im = Image.open(io.BytesIO(data))
        px_w, px_h = im.size
        w = ui_widths[rid]
        h = w * px_h / px_w
        sh.width = Cm(w)
        sh.height = Cm(h)
        log.append(f'OK  resize {rid} to {w:.2f}x{h:.2f} cm ({px_w}x{px_h})')

    # ---- 6. Keep the four-row 1.3 table together -------------------------
    t1 = doc.tables[1]
    for row in t1.rows[:-1]:
        for cell in row.cells:
            for p in cell.paragraphs:
                p.paragraph_format.keep_with_next = True
                p.paragraph_format.keep_together = True
    log.append('OK  table 1 rows keep-with-next')

    # ---- 7. Save ---------------------------------------------------------
    doc.save(OUT)
    print('\n'.join(log))
    print('OUT', OUT)
    print('BACKUP', BACKUP)


if __name__ == '__main__':
    main()
