import img2pdf
from pathlib import Path
from PIL import Image # For opening and handling images
import os # For file system operations
jobListPath = list(Path(str(os.getcwd()).replace("\\","/")+"/ai_pipeline/tests/imagePreprocessTestData/images").rglob("*.png"))
print(Path(str(os.getcwd()).replace("\\","/")+"/ai_pipeline/tests/imagePreprocessTestData/images"))
for job in jobListPath:
# Define image and PDF paths
    img_path = job
    print(job)
    pdf_path = Path(str(job).replace(".png", ".pdf"))

    # Open the image using Pillow
    image = Image.open(img_path)
    # Convert the image to PDF bytes
    pdf_bytes = img2pdf.convert(image.filename)
    # Write the PDF bytes to a file
    with open(pdf_path, "wb") as file:
        file.write(pdf_bytes)
    print(f"Successfully converted {img_path} to {pdf_path}")