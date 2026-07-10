import datetime as dt
import json
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


TEX_PATH = Path(r"c:\Users\fhmsa\Downloads\MPGV_Monitor_Project_Documentation\MPGV Monitor.tex")
OUT_PATH = Path(r"c:\Users\fhmsa\Downloads\MPGV_Monitor_Project_Documentation\Chapter_2_Reference_Cross_Verification.docx")


REPORT_DATE = dt.date(2026, 3, 18)


ENTRY_DATA = {
    "Sigmundsson2006": {
        "status": "Verified metadata; no free full PDF found",
        "used_for": "Background on Iceland's plate-boundary setting, spreading rate, volcanic hotspot context, and seismicity drivers.",
        "verification": (
            "The bibliographic metadata in the `.bib` entry matches the Springer book record. "
            "The chapter-2 claims about Iceland straddling the Mid-Atlantic Ridge and having persistent tectono-volcanic activity are consistent with the book description and later Iceland seismotectonic literature."
        ),
        "issues": "No obvious metadata error in the bibliography entry. I did not find a clearly legal free full-PDF copy.",
        "pdf_label": "No confirmed free PDF located",
        "pdf_url": "",
        "source_url": "https://link.springer.com/book/10.1007/3-540-37666-6",
    },
    "Bjornsson2008": {
        "status": "Partially verified; free PDF not located",
        "used_for": "Support for the South Iceland Seismic Zone discussion and examples of larger Icelandic earthquakes.",
        "verification": (
            "The citation is plausible and the in-text claim is broadly consistent with well-known Iceland seismic history, "
            "but I could not find a stable, citable free copy of the exact Jökull article during this verification pass."
        ),
        "issues": "Needs manual re-check against the exact Jökull paper or DOI before final submission.",
        "pdf_label": "No confirmed free PDF located",
        "pdf_url": "",
        "source_url": "https://iris.hi.is/en/publications/seismicity-pattern-in-the-south-iceland-seismic-zone/",
    },
    "Andrienko2007Geovisual": {
        "status": "Verified",
        "used_for": "Theoretical grounding for geovisual analytics, interactive visual interfaces, and spatial decision support.",
        "verification": (
            "Title, authors, journal, volume, issue, pages, and DOI align with an accessible full-text copy. "
            "The article explicitly frames geovisual analytics as combining computation and interactive visual interfaces for spatial decision support, which matches the chapter-2 use."
        ),
        "issues": "No material issue found.",
        "pdf_label": "Free PDF",
        "pdf_url": "https://bib.dbvis.de/uploadedFiles/66.pdf",
        "source_url": "https://openaccess.city.ac.uk/2843/",
    },
    "MacEachren2004Geovisualization": {
        "status": "Verified",
        "used_for": "General support for iterative analysis, interaction, and knowledge construction through geovisualization systems.",
        "verification": (
            "The `.bib` entry matches PubMed/PMC metadata for the IEEE CG&A article. "
            "The paper directly discusses geovisualization as a way to support knowledge construction and decision support, so the citation use is appropriate."
        ),
        "issues": "No material issue found.",
        "pdf_label": "Free full text (PMC page with PDF access)",
        "pdf_url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC3181162/",
        "source_url": "https://pubmed.ncbi.nlm.nih.gov/15384662/",
    },
    "Roth2013Interactive": {
        "status": "Verified",
        "used_for": "Support for interactive web maps, filtering, and user-driven exploratory cartographic interfaces.",
        "verification": (
            "The citation metadata and DOI are correct. "
            "The article is open access in JOSIS and directly reviews the science of cartographic interaction, matching the chapter-2 claims about interactive map interfaces."
        ),
        "issues": "No material issue found.",
        "pdf_label": "Free PDF",
        "pdf_url": "https://josis.org/index.php/josis/article/download/35/35/113",
        "source_url": "https://josis.org/index.php/josis/article/view/35",
    },
    "Andrienko2007Visual": {
        "status": "Problematic / likely mismatched",
        "used_for": "Support for exploration of spatio-temporal variation and time-evolving spatial patterns.",
        "verification": (
            "The chapter's use case is sensible, but the exact bibliography entry is hard to confirm as written. "
            "Search results strongly surfaced a 2004 AVI conference paper with the same title, while the `.bib` entry gives a 2007 IJGIS journal article and DOI. "
            "That combination should be manually checked before final submission."
        ),
        "issues": "Possible title/year/venue mismatch; verify against the DOI or replace with the exact source actually consulted.",
        "pdf_label": "Closest free PDF surfaced in search",
        "pdf_url": "https://citeseerx.ist.psu.edu/document?doi=c7c811271efe9821d759e0e20b616b6eda01ecc2&repid=rep1&type=pdf",
        "source_url": "https://publica.fraunhofer.de/entities/publication/bf06c00c-3943-4c44-a809-b4df710e33e2",
    },
    "Goodchild2007Citizens": {
        "status": "Verified",
        "used_for": "Conceptual bridge for heterogeneous, distributed geospatial data sources and the VGI idea.",
        "verification": (
            "The citation metadata and DOI match the GeoJournal article. "
            "The chapter uses it conceptually rather than claiming crowdsourcing in MPGV Monitor itself, which is a reasonable and transparent use."
        ),
        "issues": "No material issue found.",
        "pdf_label": "Free PDF",
        "pdf_url": "http://link.springer.com/content/pdf/10.1007/s10708-007-9111-y.pdf",
        "source_url": "https://cir.nii.ac.jp/crid/1363670319278622976",
    },
    "Netek2018": {
        "status": "Problematic / DOI mismatch",
        "used_for": "Example of a WebGIS earthquake-visualization platform and its analytical interface value.",
        "verification": (
            "The DOI in `references.bib` (`10.3390/ijgi7100395`) resolves to an unrelated bathymetry paper, not to an earthquake-visualization article. "
            "That means the current bibliography entry is not reliable as written."
        ),
        "issues": "The DOI is wrong. Rebuild this entry from the actual article you intended to cite before submission.",
        "pdf_label": "No confirmed free PDF for the exact cited item",
        "pdf_url": "",
        "source_url": "https://ouci.dntb.gov.ua/en/works/lmY02LPl/",
    },
    "Mazzei2022": {
        "status": "Verified",
        "used_for": "Recent example of web-based seismic-risk visualization and 3D WebGIS architecture.",
        "verification": (
            "The citation metadata and DOI match the MDPI article. "
            "The article clearly describes a 3D WebGIS application for visualization of seismic-risk analysis, so the chapter's use is appropriate."
        ),
        "issues": "No material issue found.",
        "pdf_label": "Free PDF",
        "pdf_url": "https://www.mdpi.com/2220-9964/11/1/22/pdf",
        "source_url": "https://www.mdpi.com/2220-9964/11/1/22",
    },
    "Netek2023": {
        "status": "Verified",
        "used_for": "Support for browser-based geospatial analysis and the growing analytical capability of WebGIS.",
        "verification": (
            "The title, authors, volume, article number, and DOI match the MDPI article. "
            "Its focus on in-browser geospatial analysis directly supports the chapter's claim about rising browser-side analytical capability."
        ),
        "issues": "No material issue found.",
        "pdf_label": "Free PDF",
        "pdf_url": "https://www.mdpi.com/2220-9964/12/9/374/pdf",
        "source_url": "https://www.mdpi.com/2220-9964/12/9/374",
    },
    "Worden2010ShakeMap": {
        "status": "Problematic / conflated reference",
        "used_for": "Support for what ShakeMap is and why hazard/intensity products matter operationally.",
        "verification": (
            "The DOI `10.3133/tm12A1` resolves to the USGS ShakeMap manual, but the official record is `Wald, Worden, Quitoriano, and Pankow (2005)`, not the 2010 six-author entry currently in `references.bib`. "
            "The existing entry appears to blend the manual with later ShakeMap-methodology literature."
        ),
        "issues": "Rebuild this entry. Either cite the 2005/2006 USGS manual correctly or replace it with the later Worden et al. methodology paper if that is what you meant.",
        "pdf_label": "Free PDF for the official manual behind the DOI",
        "pdf_url": "https://pubs.usgs.gov/tm/2005/12A01/pdf/508TM12-A1.pdf",
        "source_url": "https://pubs.usgs.gov/publication/tm12A1",
    },
    "Wald1999ShakeMap": {
        "status": "Verified; DOI missing from `.bib`",
        "used_for": "Ground-motion to intensity relationships that underpin hazard communication and ShakeMap-style products.",
        "verification": (
            "The article metadata matches the USGS/SAGE records, and the chapter's summary of PGA/PGV versus Modified Mercalli Intensity is faithful to the paper's purpose."
        ),
        "issues": "The bibliography entry would be stronger if you add DOI `10.1193/1.1586058`.",
        "pdf_label": "Publisher PDF link surfaced by index",
        "pdf_url": "https://journals.sagepub.com/doi/pdf/10.1193/1.1586058",
        "source_url": "https://pubs.usgs.gov/publication/70021541",
    },
    "MoralesGarcia2026": {
        "status": "Mostly verified; author field needs correction",
        "used_for": "Recent evidence that multi-source seismic ingestion and deduplication are active research problems.",
        "verification": (
            "The title, journal, year, article number, and DOI match the 2026 Sensors paper. "
            "The chapter's summary of heterogeneous provider formats, update frequencies, and deduplication challenges is well aligned with the paper's abstract and conclusion."
        ),
        "issues": "The `.bib` author field is inaccurate. The paper is authored by José Melgarejo-Hernández, Paula García-Tapia-Mateo, Juan Morales-García, and Jose-Norberto Mazón.",
        "pdf_label": "Free PDF",
        "pdf_url": "https://www.mdpi.com/1424-8220/26/2/451/pdf",
        "source_url": "https://www.mdpi.com/1424-8220/26/2/451",
    },
    "imo_quakes_48h": {
        "status": "Verified as a live web source; not a paper",
        "used_for": "Operational comparison point for an authoritative Icelandic earthquake map.",
        "verification": (
            "The Icelandic Meteorological Office site currently exposes an 'Earthquakes during last 48 hours' view, which matches the chapter's comparative use."
        ),
        "issues": "This is a live web application, not a paper or book, so there is no PDF copy to attach.",
        "pdf_label": "No PDF; official live page",
        "pdf_url": "https://en.vedur.is/",
        "source_url": "https://en.vedur.is/",
    },
    "usgs_latest_map": {
        "status": "Verified as a live web source; not a paper",
        "used_for": "Operational comparison point for a major global earthquake map interface.",
        "verification": (
            "USGS still provides the 'Latest Earthquakes' application, and the chapter's description of it as a broad, configurable operational platform is accurate at a high level."
        ),
        "issues": "This is a live web application, not a paper or book, so there is no PDF copy to attach.",
        "pdf_label": "No PDF; official live page",
        "pdf_url": "https://earthquake.usgs.gov/earthquakes/map/",
        "source_url": "https://earthquake.usgs.gov/earthquakes/map/",
    },
    "emsc_home": {
        "status": "Verified as a live web source; not a paper",
        "used_for": "Operational comparison point for a global earthquake portal that includes crowdsourced felt reports.",
        "verification": (
            "The EMSC site is active and the chapter's description of its combination of seismological reporting and citizen response is consistent with the current site description."
        ),
        "issues": "This is a live web application, not a paper or book, so there is no PDF copy to attach.",
        "pdf_label": "No PDF; official live page",
        "pdf_url": "https://www.emsc-csem.org/",
        "source_url": "https://www.emsc-csem.org/",
    },
}


def extract_chapter_contexts(tex_text: str):
    start = tex_text.index(r"\section{Background and Related Work}")
    end = tex_text.index(r"\section{Project Overview}")
    chapter = tex_text[start:end]
    citation_pattern = re.compile(r"\\(?:cite|parencite|textcite|autocite|footcite)\{([^}]+)\}")
    contexts = {}
    for raw_line in chapter.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        for match in citation_pattern.finditer(line):
            keys = [key.strip() for key in match.group(1).split(",")]
            for key in keys:
                contexts.setdefault(key, [])
                if line not in contexts[key]:
                    contexts[key].append(line)
    return contexts


def summarize_counts():
    counts = {"Verified": 0, "Mostly verified": 0, "Partially verified": 0, "Problematic": 0}
    for item in ENTRY_DATA.values():
        status = item["status"]
        if status.startswith("Verified"):
            counts["Verified"] += 1
        elif status.startswith("Mostly verified"):
            counts["Mostly verified"] += 1
        elif status.startswith("Partially verified"):
            counts["Partially verified"] += 1
        else:
            counts["Problematic"] += 1
    return counts


def xml_text(text: str) -> str:
    return escape(text).replace("\n", " ")


def paragraph(text=None, style=None, runs=None):
    p_style = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    if runs is None:
        runs = [text_run(text or "")]
    return f"<w:p>{p_style}{''.join(runs)}</w:p>"


def text_run(text, bold=False):
    props = "<w:rPr>"
    if bold:
        props += "<w:b/>"
    props += "</w:rPr>"
    return f"<w:r>{props}<w:t xml:space=\"preserve\">{xml_text(text)}</w:t></w:r>"


def hyperlink_run(text, rel_id):
    return (
        f'<w:hyperlink r:id="{rel_id}">'
        f'<w:r>'
        f'<w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>'
        f'<w:t xml:space="preserve">{xml_text(text)}</w:t>'
        f'</w:r>'
        f'</w:hyperlink>'
    )


def document_xml(contexts):
    rels = []
    next_rel = 10

    def add_link(url):
        nonlocal next_rel
        rel_id = f"rId{next_rel}"
        next_rel += 1
        rels.append((rel_id, url))
        return rel_id

    body = []
    body.append(paragraph("Chapter 2 Reference Cross-Verification Report", style="Title"))
    body.append(paragraph(f"Prepared on {REPORT_DATE.isoformat()}", style="Subtitle"))
    body.append(
        paragraph(
            "Scope: references cited in Chapter 2 (Background and Related Work) of MPGV Monitor were checked against accessible publisher, repository, or institutional records. "
            "For each citation, this report notes whether the bibliography entry appears correct, why the source was used in the chapter, and whether a free-access PDF or only a non-PDF official page was confirmed."
        )
    )

    counts = summarize_counts()
    body.append(paragraph("High-level results", style="Heading1"))
    for line in [
        f"Total chapter-2 citation keys reviewed: {len(ENTRY_DATA)}",
        f"Verified: {counts['Verified']}",
        f"Mostly verified but needing small bibliography fixes: {counts['Mostly verified']}",
        f"Partially verified / unresolved: {counts['Partially verified']}",
        f"Problematic or mismatched entries: {counts['Problematic']}",
    ]:
        body.append(paragraph(f"- {line}"))

    body.append(paragraph("Entry-by-entry findings", style="Heading1"))

    for key, item in ENTRY_DATA.items():
        body.append(paragraph(key, style="Heading2"))
        body.append(paragraph(runs=[text_run("Status: ", bold=True), text_run(item["status"])]))
        body.append(paragraph(runs=[text_run("Why this reference was used: ", bold=True), text_run(item["used_for"])]))
        body.append(paragraph(runs=[text_run("Cross-verification result: ", bold=True), text_run(item["verification"])]))
        body.append(paragraph(runs=[text_run("Issues / follow-up: ", bold=True), text_run(item["issues"])]))

        chapter_lines = contexts.get(key, [])
        if chapter_lines:
            body.append(paragraph(runs=[text_run("Chapter-2 citation context: ", bold=True), text_run(chapter_lines[0])]))

        link_runs = [text_run("Accessible link: ", bold=True)]
        if item["pdf_url"]:
            link_runs.append(hyperlink_run(item["pdf_label"], add_link(item["pdf_url"])))
        else:
            link_runs.append(text_run(item["pdf_label"]))
        if item["source_url"]:
            link_runs.append(text_run(" | Source/record: "))
            link_runs.append(hyperlink_run(item["source_url"], add_link(item["source_url"])))
        body.append(paragraph(runs=link_runs))

    sect = (
        "<w:sectPr>"
        "<w:pgSz w:w=\"12240\" w:h=\"15840\"/>"
        "<w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>"
        "</w:sectPr>"
    )
    body_xml = "".join(body) + sect

    xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" '
        'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
        'xmlns:o="urn:schemas-microsoft-com:office:office" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
        'xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:w10="urn:schemas-microsoft-com:office:word" '
        'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
        'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" '
        'xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" '
        'xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" '
        'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
        'mc:Ignorable="w14 wp14">'
        f"<w:body>{body_xml}</w:body>"
        "</w:document>"
    )
    return xml, rels


def relationships_xml(links):
    rows = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    ]
    for rel_id, url in links:
        rows.append(
            f'<Relationship Id="{rel_id}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
            f'Target="{escape(url)}" TargetMode="External"/>'
        )
    rows.append("</Relationships>")
    return "".join(rows)


def styles_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:sz w:val="22"/>
      <w:szCs w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
      <w:szCs w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:color w:val="666666"/>
      <w:sz w:val="22"/>
      <w:szCs w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:basedOn w:val="DefaultParagraphFont"/>
    <w:uiPriority w:val="99"/>
    <w:unhideWhenUsed/>
    <w:rPr>
      <w:color w:val="0563C1"/>
      <w:u w:val="single"/>
    </w:rPr>
  </w:style>
</w:styles>
"""


def content_types_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""


def package_rels_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""


def main():
    tex_text = TEX_PATH.read_text(encoding="utf-8", errors="replace")
    contexts = extract_chapter_contexts(tex_text)
    document, rels = document_xml(contexts)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT_PATH, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml())
        zf.writestr("_rels/.rels", package_rels_xml())
        zf.writestr("word/document.xml", document)
        zf.writestr("word/_rels/document.xml.rels", relationships_xml(rels))
        zf.writestr("word/styles.xml", styles_xml())

    print(json.dumps({"written": str(OUT_PATH), "entries": len(ENTRY_DATA)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
