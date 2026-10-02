from pathlib import Path
from io import BytesIO
import shutil
from pypdf import PdfReader

root = Path.cwd()
out_dir = root / "pdf_extracted" / "images"
if out_dir.exists():
    shutil.rmtree(out_dir)
out_dir.mkdir(parents=True)

pdf_specs = [
    (root / "147666234-Delta-v-Course-7009-1.pdf", "7009-1"),
    (root / "740124885-Deltav-O-M-Training-Manual.pdf", "Deltav-O-M-Training-Manual"),
]

try:
    from PIL import Image
except ImportError:
    Image = None

all_images = []
for pdf_path, prefix in pdf_specs:
    if not pdf_path.exists():
        raise FileNotFoundError(f"Missing PDF: {pdf_path}")
    reader = PdfReader(str(pdf_path))
    count = 0
    for page_number, page in enumerate(reader.pages, start=1):
        for image_number, image in enumerate(page.images, start=1):
            original_name = getattr(image, "name", "") or ""
            extension = Path(str(original_name)).suffix.lower()
            if not extension:
                extension = ".bin"
            filename = f"{prefix}_p{page_number:02d}_img{image_number:02d}{extension}"
            destination = out_dir / filename
            data = image.data
            destination.write_bytes(data)
            width = height = None
            if Image is not None:
                try:
                    with Image.open(BytesIO(data)) as opened:
                        width, height = opened.size
                except Exception:
                    pass
            if (width is None or height is None) and hasattr(image, "image"):
                try:
                    width, height = image.image.size
                except Exception:
                    pass
            all_images.append({
                "pdf": pdf_path.name,
                "path": destination.relative_to(root),
                "bytes": len(data),
                "width": width,
                "height": height,
            })
            count += 1
    print(f"{pdf_path.name}: {count} images extracted")

print("\n15 largest images by file size across both PDFs:")
for rank, item in enumerate(sorted(all_images, key=lambda x: x["bytes"], reverse=True)[:15], start=1):
    dimensions = f'{item["width"]} x {item["height"]}' if item["width"] is not None else "unknown x unknown"
    print(f'{rank:2d}. {item["path"]} | {item["bytes"]:,} bytes | {dimensions}')
