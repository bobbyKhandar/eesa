import time
import gc
from pathlib import Path
from pdf2image import convert_from_path
from PIL import Image
import cv2
import numpy as np
import easyocr
import re
import os


keyword_map : dict[str,str] = {
   # --- B.Tech Programs (Merged Variations) ---
    "ETRX": "ETRX",
    "ETRX_MJ 21": "ETRX",
    "ELECTRONICS": "ETRX",
    "ELECTRONICS ENGINEERING": "ETRX",
    
    "ME ENERGY": "ME_ENERGY",  # M.E Energy (separate)
    "ME ENRY": "ME_ENERGY",    # Typo fix
    "ME ENR": "ME_ENERGY",     # Typo fix

    "SEM - V COMP": "COMP",

    "ME ETRX": "ME_ETRX",      # M.E Electronics (separate)
    "SEM - III ETRX": "ETRX",

    "IT": "IT",
    "I.T": "IT",
    "INFORMATION TECHNOLOGY": "IT",
    "ME INS": "ME_IT",         # M.E IT (separate)
    "ME INFORMATION SECURITY": "ME_IT",
    "IT_MJ 21": "IT",
    "SEM - III .I.T": "IT",
    "SEM - III I.T": "IT",
    "IT_SEM VIII": "IT",

    "Sem . III Comp": "COMP",
    "COMP": "COMP",
    "SEM - V . COMP": "COMP",
    "COMPUTER": "COMP",
    "COMPUTER ENGINEERING": "COMP",
    "ME COMP": "ME_COMP",      # M.E Computer (separate)
    "COMP_SEM VIII": "COMP",
    "SEM - VII COMP": "COMP",

    "EXTC": "EXTC",
    "ELECTRONICS AND TELECOMMUNICATION": "EXTC",
    "EXCP": "EXTC",            # Typo fix
    "EXTC_MJ 21": "EXTC",
    "SEM - VII EXTC": "EXTC",
    "ME EXTC": "ME_EXTC",      # M.E EXTC (separate)

    "MECH": "MECH",
    "Sem -III Mech": "MECH",
    "MECH_ SEM VIII": "MECH",
    "MECH_MJ 21": "MECH",
    "MECHANICAL": "MECH",
    "MECHA": "MECH",           # Typo fix
    "ME CAD CAM": "ME_CAD_CAM", # M.E CAD/CAM (separate)
    "ME CAD CAM ROBOTIC": "ME_CAD_CAM",
    "ME CAD CAM ROBOTICS": "ME_CAD_CAM",
    "SEM - V MECH": "MECH",
    "Mechatronics": "MECH",

    # --- First Year ---
    "FE": "FE",
    "FIRST YEAR": "FE",
    "SEM I": "FE",
    "SEM II": "FE",
    "First Year Sem I": "FE",
    "SEM - I & II (ALL)": "FE",

    # --- Autonomous (Treated as Regular) ---
    "AUTONOMOUS": "",          # Ignored (no separate dir)
    "KJSCE AUTONOMOUS": "",    # Ignored (no separate dir)
    "COMP AUTONOMOUS": "COMP", # Merged into regular COMP
    "ETRX AUTONOMOUS": "ETRX",
    "SEM - VII ETRX": "ETRX",
    "EXTC AUTONOMOUS": "EXTC",
    "IT AUTONOMOUS": "IT",
    "MECH AUTONOMOUS": "MECH",

    # --- Inter-Disciplinary ---
    "IDC": "IDC",

    # --- Honors/Minor ---
    "HONOUR": "HONOUR",
    "HONOURS": "HONOUR",
    "MINOR": "MINOR",

    # --- Robotics & AI ---
    "ROBOTICS AND A.I": "ROBOTICS_AI",
    "ROBOTICS": "ROBOTICS_AI",

    # --- M.Tech (Separate) ---
    "M TECH": "MTECH",
    "M.TECH": "MTECH",
    "SEM - III M.TECH": "MTECH",
    "MTECH Sem III ND 2021": "MTECH",
    "5) M.TECH - I": "MTECH",
    "5) M. TECH - I": "MTECH",
    "M. Tech": "MTECH",
    "M.TECH SEM I": "MTECH",
    "MTECH COMP": "MTECH_COMP",
    "M.Tech. Comp. Sem - I": "MTECH_COMP",
    "MTECH ETRX": "MTECH_ETRX",
    "M.Tech. Mech. Sem -I": "MTECH_MECH",
    "M.Tech. Extc. Sem - I": "MTECH_EXTC",
    "MTECH EXTC": "MTECH_EXTC",
    "MTECH IT": "MTECH_IT",
    "M.Tech. I.T. Sem - I": "MTECH_IT",
    "MTECH MECH": "MTECH_MECH",

    # --- PhD (Separate) ---
    "PHD": "PHD",

    # --- Fallbacks (Unchanged) ---
    "ME": "ME",  # Generic M.E (if not categorized)

    # --- Newly extracted (precise additions) ---
    "ETRX_SEM VIII": "ETRX",
    "EXTC_SEM VIII": "EXTC",
    "SEM - III COMP": "COMP",
    "SEM - III ETRX": "ETRX",
    "SEM - III EXTC": "EXTC",
    "SEM - III MECH": "MECH",
    "SEM - V ETRX": "ETRX",
    "SEM - V EXTC": "EXTC",
    "SEM - V I.T": "IT",
    "SEM - VII I.T": "IT",
    "SEM - VII MECH": "MECH",
    "SEM - VII COMP": "COMP",
    "Sem - III .EXTC": "EXTC",


}


def get_all_files(root_dir):
    return list(Path(root_dir).rglob("*.pdf"))  # Only PDFs, be specific


def detect_skew_angle(image):
    angles = []
    edges = cv2.Canny(image, 30, 100, apertureSize=3)

    for threshold in [50, 100, 150]:
        lines = cv2.HoughLines(edges, 1, np.pi/360, threshold=threshold)
        if lines is not None and len(lines) > 5:
            line_angles = []
            for line in lines[:50]:
                rho, theta = line[0]
                angle = np.rad2deg(theta) - 90
                if abs(angle) < 10:
                    line_angles.append(angle)
            if line_angles:
                hist, bin_edges = np.histogram(line_angles, bins=20, range=(-10, 10))
                max_bin_idx = np.argmax(hist)
                mode_angle = (bin_edges[max_bin_idx] + bin_edges[max_bin_idx + 1]) / 2
                angles.append(mode_angle)
                break

    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
    horizontal_lines = cv2.morphologyEx(edges, cv2.MORPH_OPEN, horizontal_kernel)
    contours, _ = cv2.findContours(horizontal_lines, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    horizontal_angles = []
    for contour in contours:
        if cv2.contourArea(contour) > 200 and len(contour) > 10:
            [vx, vy, x, y] = cv2.fitLine(contour, cv2.DIST_L2, 0, 0.01, 0.01)
            angle = np.rad2deg(np.arctan2(vy, vx))
            if abs(angle) < 15:
                horizontal_angles.append(angle)
    if horizontal_angles:
        angles.append(np.median(horizontal_angles))

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        largest = max(contours, key=cv2.contourArea)
        if cv2.contourArea(largest) > image.shape[0] * image.shape[1] * 0.1:
            rect = cv2.minAreaRect(largest)
            angle = rect[2]
            if angle < -45:
                angle += 90
            elif angle > 45:
                angle -= 90
            if abs(angle) < 15:
                angles.append(-angle)

    if not angles:
        return 0
    final_angle = np.median(angles)
    if abs(final_angle) < 0.5:
        fine_edges = cv2.Canny(image, 20, 60)
        lines = cv2.HoughLines(fine_edges, 0.5, np.pi/720, threshold=30)
        if lines is not None:
            fine_angles = []
            for line in lines[:100]:
                rho, theta = line[0]
                angle = np.rad2deg(theta) - 90
                if abs(angle) < 5:
                    fine_angles.append(angle)
            if fine_angles:
                return np.median(fine_angles)
    return final_angle

def imagePreprocess(img):
    pilImg = img.convert("RGB")
    opencvRGB_img = np.array(pilImg)
    opencv_img = cv2.cvtColor(opencvRGB_img, cv2.COLOR_RGB2BGR)

    gray = cv2.cvtColor(opencv_img, cv2.COLOR_BGR2GRAY)
    gray_small = cv2.resize(gray, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    denoised_small = cv2.fastNlMeansDenoising(gray_small, h=16)
    denoised = cv2.resize(denoised_small, gray.shape[::-1], interpolation=cv2.INTER_CUBIC)
    
    angle = detect_skew_angle(denoised)
    if abs(angle) < 0.1:
        deskewed = denoised
    else:
        (h, w) = denoised.shape[:2]
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        cos_val, sin_val = np.abs(M[0, 0]), np.abs(M[0, 1])
        new_w, new_h = int(h * sin_val + w * cos_val), int(h * cos_val + w * sin_val)
        M[0, 2] += (new_w / 2) - center[0]
        M[1, 2] += (new_h / 2) - center[1]
        deskewed = cv2.warpAffine(denoised, M, (new_w, new_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=255)

    thresh = cv2.adaptiveThreshold(deskewed, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY, 11, 2)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 1))
    cleaned = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    final_img = clahe.apply(cleaned)
    return final_img

def pdfToImage(pdf):
    return convert_from_path(pdf, dpi=300)

def getDirName(out_name):
    for part in out_name.parts:
        if part.upper() in keyword_map:
            dest= Path(keyword_map.get(part.upper()))  / str(out_name).replace("\\","-")
            return dest
    return Path("unresolved")/str(out_name).replace("\\","-")

def sanitize(text: str) -> str:
    text = re.sub(r'[\x00-\x08\x0B-\x0C\x0E-\x1F]', '', text)
    text = text.replace('“', '').replace('”', '').replace('‘', "").replace('’', "").replace('\u00ad', '')
    text = re.sub(r'\\(?!["\\/bfnrtu])', '', text)
    return re.sub(r'[ \t]+', ' ', text)

def startOcr(filepath):
    reader = easyocr.Reader(['en'], verbose=False)
    DEST_DIR = Path("C:/ocr_output")
    DEST_DIR.mkdir(parents=True, exist_ok=True)

    files = get_all_files(filepath)
    print(f"[INFO] Total files found: {len(files)}")

    
    for _,dirName in keyword_map.items():
        temp=DEST_DIR/dirName
        temp.mkdir(parents=True, exist_ok=True)

    for file in files:
        try:
            print(f"[INFO] Processing PDF: {file}")
            images = pdfToImage(file)
            unfilteredText = ""
            for i, image in enumerate(images):
                print(f"    - Page {i+1}")
                try:
                    final = imagePreprocess(image)
                    results = reader.readtext(final)
                    text = [line for _, line, _ in results]
                    unfilteredText += "\n".join(text) + "\n"
                    del image, final, results
                except Exception as e:
                    print(f"    [ERROR] Page {i+1} failed: {e}")
            sanitized = sanitize(unfilteredText)

            # Safe fallback name using stem (filename without extension)
            out_name = Path(*file.parts[6:]).with_suffix(".txt")
            dest=DEST_DIR / getDirName(out_name)
        
            if len(str(dest)) > 260:
                print("max limit of file name exceeded changing the path type")
                dest = Path(f"\\\\?\\{dest.absolute()}")
            
            with open(dest, "w", encoding="utf-8") as f:
                f.write(sanitized)
            print(f"[SUCCESS] Saved to {dest}")
            file.unlink()
        except Exception as e:
            print(f"[CRASHED] Skipping {file}: {e}")    
        finally:
            gc.collect()


def getFolderNames():
    root_dir = Path(r'C:\Users\bobby\Downloads\Past Question Papers-20250521T094120Z-1-001\Past Question Papers')  # Replace this with your root directory
    pdf_dirs = set()

    for pdf in root_dir.rglob("*.pdf"):
        pdf_dirs.add(pdf.parent)
    print(f"length of remaining files={len(pdf_dirs)}")
    uniqueNames=set()
    for d in sorted(pdf_dirs):
        parts = list(d.parts[-1:])  # all parts except last folder
        for s in parts:
            uniqueNames.add(s)
    
    for n in uniqueNames:
        print(n)

    # getFolderNames()
startOcr(r'C:\Users\bobby\Downloads\Past Question Papers-20250521T094120Z-1-001\Past Question Papers')
