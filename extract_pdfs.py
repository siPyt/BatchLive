from pathlib import Path
from pypdf import PdfReader

BASE = Path(__file__).resolve().parent
OUT = BASE / "pdf_extracted"
OUT.mkdir(exist_ok=True)
PDFS = [
    "147666234-Delta-v-Course-7009-1.pdf",
    "158798969-Delta-v-Course-7009-5.pdf",
    "175179979-DeltaV-Function.pdf",
    "260183230-DeltaV-Sequence-Tutorial.pdf",
    "740124885-Deltav-O-M-Training-Manual.pdf",
]

results = []
for name in PDFS:
    src = BASE / name
    dest = OUT / (src.stem + ".txt")
    try:
        reader = PdfReader(str(src))
        text_parts = []
        for page in reader.pages:
            text_parts.append(page.extract_text() or "")
        dest.write_text("\n".join(text_parts), encoding="utf-8")
        results.append((name, dest, None))
    except Exception as exc:
        results.append((name, dest, exc))

for name, dest, error in results:
    print(f"=== {name} ===")
    if error is not None:
        print(f"EXTRACTION FAILED: {type(error).__name__}: {error}")
        continue
    size_kb = dest.stat().st_size / 1024
    print(f"Output: {dest.name} | Size: {size_kb:.2f} KB")
    print("--- first 60 lines ---")
    try:
        lines = dest.read_text(encoding="utf-8").splitlines()
        if not lines:
            print("[no extracted text]")
        else:
            for number, line in enumerate(lines[:60], 1):
                print(f"{number:02d}: {line}")
    except Exception as exc:
        print(f"PREVIEW FAILED: {type(exc).__name__}: {exc}")
    print()
