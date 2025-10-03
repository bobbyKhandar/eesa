import os
import re
import json
from glob import glob
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# === CONFIG ===
FOLDER = "C:/Users/bobby/Downloads/temo"
SIM_THRESHOLD = 0.7

# === STEP 1: Load and clean all questions
def clean(text):
    return re.sub(r"[^\w\s]", "", text.lower().strip())

all_questions = []
file_sources = []

for filepath in glob(os.path.join(FOLDER, "*.txt")):
    with open(filepath, "r", encoding="utf-8") as f:
        raw = f.read()
    try:
        json_part = raw[raw.find("{"):]
        data = json.loads(json_part)
        for subject, items in data.items():
            for q in items:
                cleaned = clean(q["question"])
                all_questions.append(cleaned)
                file_sources.append(os.path.basename(filepath))
    except Exception as e:
        print(f"[ERROR] Failed on {filepath}: {e}")

# === STEP 2: TF-IDF + cosine similarity
vectorizer = TfidfVectorizer()
X = vectorizer.fit_transform(all_questions)
sim_matrix = cosine_similarity(X)

# === STEP 3: Group similar questions
visited = set()
groups = []

for i in range(len(all_questions)):
    if i in visited:
        continue
    group = {
        "canonical": all_questions[i],
        "times_asked": 1,
        "sources": [file_sources[i]]
    }
    visited.add(i)
    for j in range(i + 1, len(all_questions)):
        if j not in visited and sim_matrix[i][j] >= SIM_THRESHOLD:
            visited.add(j)
            group["times_asked"] += 1
            group["sources"].append(file_sources[j])
    groups.append(group)

# === STEP 4: Sort groups by times_asked DESC
groups.sort(key=lambda g: g["times_asked"], reverse=True)

# === STEP 5: Save grouped JSON
with open("C:/Users/bobby/Downloads/temp2/grouped_questions.json", "w", encoding="utf-8") as f:
    json.dump(groups, f, indent=2)

# === STEP 6: Save unique questions TXT with counts
with open("C:/Users/bobby/Downloads/temp2/unique_questions.txt", "w", encoding="utf-8") as f:
    for group in groups:
        f.write(f"{group['canonical']} — times asked: {group['times_asked']}\n")

print(f"\n✅ Grouped {len(all_questions)} into {len(groups)} unique questions (sorted).")
print("→ Output: grouped_questions.json")
print("→ Output: unique_questions.txt")
