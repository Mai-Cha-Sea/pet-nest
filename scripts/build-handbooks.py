"""从可维护的 Markdown 原稿生成四册 Word 手册，不读取真实环境配置。

依赖 python-docx。文档源、输出和附录映射集中在 BOOKS；业务源码不依赖本脚本。
生成后仍须用 Word/兼容排版引擎渲染逐页检查，不能把生成成功当作排版验收。
"""

from __future__ import annotations

import argparse
import re
from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION_START
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
BOOKS = [
    ("docs/USER-GUIDE.md", "01_宠物小窝用户使用说明.docx", "实际使用者"),
    ("docs/manuals/02-development.md", "02_开发接手与维护指南.docx", "接手开发者"),
    ("docs/manuals/03-operations.md", "03_部署与内容审核指南.docx", "维护者与审核管理员"),
    ("docs/manuals/04-testing.md", "04_测试与验收指南.docx", "测试与验收人员"),
]


def font(run, size=None, bold=None, code=False, color=None):
    run.font.name = "Consolas" if code else "Calibri"
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    return run


def field(paragraph, instruction):
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    text = OxmlElement("w:instrText")
    text.set(qn("xml:space"), "preserve")
    text.text = instruction
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    display = OxmlElement("w:t")
    display.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for item in (begin, text, separate, display, end):
        run = font(paragraph.add_run(), size=9, color="606A73")
        run._r.append(item)


def link(paragraph, text, url=None, anchor=None, size=None):
    from docx.opc.constants import RELATIONSHIP_TYPE

    element = OxmlElement("w:hyperlink")
    if anchor:
        element.set(qn("w:anchor"), anchor)
    else:
        relation = paragraph.part.relate_to(url, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
        element.set(qn("r:id"), relation)
    run = OxmlElement("w:r")
    props = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "245D76")
    props.append(color)
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    props.append(underline)
    fonts = OxmlElement("w:rFonts")
    fonts.set(qn("w:ascii"), "Calibri")
    fonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    props.append(fonts)
    if size:
        sz = OxmlElement("w:sz")
        sz.set(qn("w:val"), str(int(size * 2)))
        props.append(sz)
    run.append(props)
    label = OxmlElement("w:t")
    label.text = text
    run.append(label)
    element.append(run)
    paragraph._p.append(element)


def inline(paragraph, text, size=None, color=None):
    pattern = re.compile(r"\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`")
    position = 0
    for match in pattern.finditer(text):
        font(paragraph.add_run(text[position:match.start()]), size=size, color=color)
        if match.group(1):
            url = match.group(2)
            if not re.match(r"https?://", url):
                url = "https://github.com/Mai-Cha-Sea/pet-nest/blob/main/docs/" + url
            link(paragraph, match.group(1), url=url, size=size)
        else:
            code = match.group(4) is not None
            font(paragraph.add_run(match.group(4) or match.group(3)), size=(size or 10.5) if code else size, bold=not code, code=code, color=color)
        position = match.end()
    font(paragraph.add_run(text[position:]), size=size, color=color)


def clean_heading(text):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\u4e00-\u9fff ]", " ", text)).strip()


def blocks(source):
    """解析项目手册使用的有限 Markdown，未知复杂格式不默默转换为假结构。"""
    lines = source.splitlines()
    result = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
        elif line.startswith("<!--"):
            result.append(("marker", line))
            i += 1
        elif line.startswith("```"):
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            result.append(("code", code))
            i += 1
        elif line.startswith("#"):
            match = re.match(r"^(#{1,6})\s+(.+)$", line)
            if not match:
                raise ValueError("Invalid heading")
            result.append(("heading", (len(match[1]), match[2])))
            i += 1
        elif line.startswith("|"):
            table = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [part.strip() for part in re.split(r"(?<!\\)\|", lines[i].strip().strip("|"))]
                if not all(re.fullmatch(r":?-{2,}:?", cell) for cell in cells):
                    table.append(cells)
                i += 1
            if len({len(row) for row in table}) != 1:
                raise ValueError("Inconsistent table columns")
            result.append(("table", table))
        elif re.match(r"^(?:\d+\.\s+|[-*]\s+)", line):
            ordered = bool(re.match(r"\d+\.", line))
            items = []
            while i < len(lines):
                match = re.match(r"^(\d+\.|[-*])\s+(.+)$", lines[i].strip())
                if not match or bool(re.match(r"\d+\.", match[1])) != ordered:
                    break
                items.append(match[2])
                i += 1
            result.append(("list", (ordered, items)))
        else:
            paragraph = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||```|<!--|\d+\.\s|[-*]\s)", lines[i].strip()):
                paragraph.append(lines[i].strip())
                i += 1
            result.append(("paragraph", " ".join(paragraph)))
    return result


def setup(doc, title):
    doc.core_properties.title = title
    doc.core_properties.author = "宠物小窝项目维护者"
    doc.core_properties.last_modified_by = "宠物小窝项目维护者"
    doc.core_properties.subject = "0.2.0 P1 使用与项目维护"
    doc.core_properties.comments = "依据当前项目源码和版本化 Markdown 编制。"
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.7)
    section.bottom_margin = Inches(0.65)
    section.left_margin = section.right_margin = Inches(0.8)
    section.header_distance = section.footer_distance = Inches(0.3)
    styles = doc.styles
    for name, size in [("Normal", 11.5), ("Title", 26), ("Subtitle", 11), ("Heading 1", 17), ("Heading 2", 13.5), ("Heading 3", 12), ("List Bullet", 11.5), ("List Number", 11.5)]:
        style = styles[name]
        style.font.name = "Calibri"
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        style.paragraph_format.line_spacing = 1.22
        style.paragraph_format.space_after = Pt(7)
        style.paragraph_format.widow_control = True
        if name.startswith("Heading"):
            style.paragraph_format.keep_with_next = True
            style.paragraph_format.space_before = Pt(15)
            style.paragraph_format.space_after = Pt(7)
    styles["Title"].font.bold = True
    styles["Title"].paragraph_format.space_after = Pt(10)
    for style_name in ("Title", "Subtitle"):
        paragraph_props = styles[style_name].element.find(qn("w:pPr"))
        if paragraph_props is not None:
            for border in list(paragraph_props.findall(qn("w:pBdr"))):
                paragraph_props.remove(border)
    header = section.header.paragraphs[0]
    font(header.add_run(title), size=9, color="000000")
    footer = section.footer.paragraphs[0]
    footer.paragraph_format.tab_stops.add_tab_stop(Inches(6.9), WD_TAB_ALIGNMENT.RIGHT)
    font(footer.add_run("宠物小窝  0.2.0  ·  2026-10-29\t第 "), size=9, color="606A73")
    field(footer, "PAGE")
    font(footer.add_run(" 页  共 "), size=9, color="606A73")
    field(footer, "NUMPAGES")
    font(footer.add_run(" 页"), size=9, color="606A73")


def bookmark(paragraph, name, number):
    begin = OxmlElement("w:bookmarkStart")
    begin.set(qn("w:id"), str(number))
    begin.set(qn("w:name"), name)
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), str(number))
    paragraph._p.insert(1 if paragraph._p.pPr is not None else 0, begin)
    paragraph._p.append(end)


def numbering(doc, ordered):
    root = doc.part.numbering_part.element
    existing = [int(el.get(qn("w:abstractNumId"))) for el in root.findall(qn("w:abstractNum"))]
    abstract_id = max(existing, default=-1) + 1
    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))
    level = OxmlElement("w:lvl")
    level.set(qn("w:ilvl"), "0")
    for tag, val in [("start", "1"), ("numFmt", "decimal" if ordered else "bullet"), ("lvlText", "%1." if ordered else "•")]:
        element = OxmlElement("w:" + tag)
        element.set(qn("w:val"), val)
        level.append(element)
    props = OxmlElement("w:pPr")
    indent = OxmlElement("w:ind")
    indent.set(qn("w:left"), "360")
    indent.set(qn("w:hanging"), "250")
    props.append(indent)
    level.append(props)
    abstract.append(level)
    first_num = root.find(qn("w:num"))
    root.insert(root.index(first_num), abstract) if first_num is not None else root.append(abstract)
    num_id = max([int(el.get(qn("w:numId"))) for el in root.findall(qn("w:num"))], default=0) + 1
    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))
    ref = OxmlElement("w:abstractNumId")
    ref.set(qn("w:val"), str(abstract_id))
    num.append(ref)
    root.append(num)
    return num_id


def add_table(doc, rows, landscape=False):
    columns = len(rows[0])
    total = 9.4 if landscape else 6.9
    widths = [0.85, 0.8, 0.45, 2.0, 1.85, 3.45] if columns == 6 else ([2.0, total - 2.0] if columns == 2 else [1.45, (total - 1.45) * 0.45, (total - 1.45) * 0.55])
    if columns not in (2, 3, 6):
        widths = [total / columns] * columns
    # 配置名需完整可辨认，给长环境变量更宽的列，避免单个字母落在下一行。
    if rows[0] == ["配置", "保存位置和含义"]:
        widths = [3.15, total - 3.15]
    table = doc.add_table(rows=0, cols=columns)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table_props = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        element = OxmlElement("w:" + edge)
        for key, val in [("val", "single"), ("sz", "4"), ("color", "D9D9D9")]:
            element.set(qn("w:" + key), val)
        borders.append(element)
    table_props.insert_element_before(borders, "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook", "w:tblCaption", "w:tblDescription")
    for index, row in enumerate(rows):
        cells = table.add_row().cells
        row_props = cells[0]._tc.getparent().get_or_add_trPr()
        no_split = OxmlElement("w:cantSplit")
        row_props.append(no_split)
        if index == 0:
            repeat = OxmlElement("w:tblHeader")
            row_props.append(repeat)
        for col, (cell, text) in enumerate(zip(cells, row)):
            cell.width = Inches(widths[col])
            table.columns[col].width = Inches(widths[col])
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            props = cell._tc.get_or_add_tcPr()
            shading = OxmlElement("w:shd")
            shading.set(qn("w:fill"), "253F54" if index == 0 else ("F2F5F7" if index % 2 == 0 else "FFFFFF"))
            props.insert_element_before(shading, "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign", "w:hideMark")
            margins = OxmlElement("w:tcMar")
            for edge in ("top", "bottom", "left", "right"):
                value = OxmlElement("w:" + edge)
                value.set(qn("w:w"), "80" if edge in ("top", "bottom") else "100")
                value.set(qn("w:type"), "dxa")
                margins.append(value)
            props.insert_element_before(margins, "w:textDirection", "w:tcFitText", "w:vAlign", "w:hideMark")
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(3)
            paragraph.paragraph_format.space_before = Pt(3)
            paragraph.paragraph_format.line_spacing = 1.15
            paragraph.paragraph_format.keep_with_next = index == 0
            if index == 0 or (columns == 6 and col < 3):
                paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            inline(paragraph, text.replace("\\|", "|"), size=10.5, color="FFFFFF" if index == 0 else "000000")
            if index == 0:
                for run in paragraph.runs:
                    run.bold = True
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(3)
    spacer.paragraph_format.space_before = Pt(0)
    spacer.paragraph_format.line_spacing = Pt(3)
    font(spacer.add_run(""), size=3)


def matrix_blocks():
    source = (ROOT / "docs/TEST-MATRIX.md").read_text(encoding="utf-8")
    selected = source[source.index("## 环境、迁移与交付"):source.index("## 不纳入当前开发的项目")]
    result = blocks(selected)
    count = sum(len(value) - 1 for kind, value in result if kind == "table")
    if count != 101:
        raise ValueError(f"Expected 101 appendix scenarios, got {count}")
    return result


def build(source_path, filename, audience, out):
    source = (ROOT / source_path).read_text(encoding="utf-8")
    content = blocks(source)
    title = clean_heading(content[0][1][1])
    doc = Document()
    setup(doc, title)
    doc.add_paragraph(title, style="Title")
    doc.add_paragraph("适用读者  " + audience, style="Subtitle")
    first = next(value for kind, value in content if kind == "paragraph")
    inline(doc.add_paragraph(), first)
    chapters = [clean_heading(value[1]) for kind, value in content if kind == "heading" and value[0] == 2]
    nav = doc.add_paragraph("内容导航")
    nav.paragraph_format.space_before = Pt(10)
    nav.paragraph_format.keep_with_next = True
    font(nav.runs[0], size=12, bold=True)
    for index, heading in enumerate(chapters, 1):
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.space_after = Pt(3)
        link(paragraph, heading, anchor="chapter_" + str(index))
    doc.add_page_break()
    chapter = 0
    landscape = False
    skip_intro = True
    for kind, value in content[1:]:
        if kind == "paragraph" and skip_intro:
            skip_intro = False
            continue
        if kind == "heading":
            level, text = value
            text = clean_heading(text)
            if level == 2 and text == "完整场景表附录":
                previous_footer = deepcopy(doc.sections[-1].footer.paragraphs[0]._p)
                section = doc.add_section(WD_SECTION_START.NEW_PAGE)
                section.orientation = WD_ORIENT.LANDSCAPE
                section.page_width = Inches(11)
                section.page_height = Inches(8.5)
                section.footer.is_linked_to_previous = False
                section.footer.paragraphs[0]._p.getparent().replace(section.footer.paragraphs[0]._p, previous_footer)
                section.footer.paragraphs[0].paragraph_format.tab_stops.clear_all()
                section.footer.paragraphs[0].paragraph_format.tab_stops.add_tab_stop(Inches(9.4), WD_TAB_ALIGNMENT.RIGHT)
                landscape = True
            paragraph = doc.add_paragraph(text, style="Heading " + str(min(3, max(1, level - 1))))
            if level == 2:
                chapter += 1
                bookmark(paragraph, "chapter_" + str(chapter), chapter)
        elif kind == "paragraph":
            inline(doc.add_paragraph(), value)
        elif kind == "list":
            ordered, items = value
            num_id = numbering(doc, ordered)
            for item in items:
                paragraph = doc.add_paragraph()
                paragraph.paragraph_format.space_after = Pt(5)
                num = paragraph._p.get_or_add_pPr().get_or_add_numPr()
                lvl = OxmlElement("w:ilvl")
                lvl.set(qn("w:val"), "0")
                identifier = OxmlElement("w:numId")
                identifier.set(qn("w:val"), str(num_id))
                num.extend([lvl, identifier])
                inline(paragraph, item)
        elif kind == "table":
            add_table(doc, value, landscape)
        elif kind == "code":
            for i, line in enumerate(value):
                paragraph = doc.add_paragraph()
                paragraph.paragraph_format.left_indent = Inches(0.12)
                paragraph.paragraph_format.right_indent = Inches(0.08)
                paragraph.paragraph_format.space_after = Pt(0 if i < len(value) - 1 else 8)
                paragraph.paragraph_format.line_spacing = 1.05
                paragraph.paragraph_format.keep_with_next = i < len(value) - 1
                font(paragraph.add_run(line or " "), size=9.5, code=True)
        elif kind == "marker" and value == "<!-- TEST_MATRIX_APPENDIX -->":
            for subkind, subvalue in matrix_blocks():
                if subkind == "heading":
                    doc.add_paragraph(clean_heading(subvalue[1]), style="Heading 2")
                elif subkind == "table":
                    add_table(doc, subvalue, True)
                elif subkind == "paragraph":
                    inline(doc.add_paragraph(), subvalue)
    target = out / filename
    doc.save(target)
    return target


def main():
    parser = argparse.ArgumentParser(description="生成四册宠物小窝 Word 手册")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "docs/word")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for source, filename, audience in BOOKS:
        target = build(source, filename, audience, args.output_dir)
        print(target.relative_to(ROOT) if target.is_relative_to(ROOT) else target)


if __name__ == "__main__":
    main()
