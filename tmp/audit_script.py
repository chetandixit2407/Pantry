import os
import re
import json

files_to_check = [
    "index.html",
    "metadata.json",
    "src/App.tsx",
    "src/main.tsx",
    "src/types/index.ts",
    "src/services/api.ts",
    "src/context/AuthContext.tsx",
    "src/utils/textNormalizer.ts",
    "src/components/auth/BubbleLoginPage.tsx",
    "src/components/common/AuthTransitionScreen.tsx",
    "src/components/common/CameraCaptureModal.tsx",
    "src/components/common/Card3D.tsx",
    "src/components/common/Navbar.tsx",
    "src/components/pantry/PantryBoyView.tsx",
    "src/components/management/ManagementView.tsx",
    "src/components/management/RealtimeRoomDashboard.tsx",
    "server.ts"
]

a_an_re = re.compile(r"\b(a)\s+([aeiou][a-z]+)\b", re.IGNORECASE)
an_a_re = re.compile(r"\b(an)\s+([bcdfghjklmnpqrstvwxyz][a-z]+)\b", re.IGNORECASE)

issues = []

for filepath in files_to_check:
    if not os.path.exists(filepath):
        continue
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()

    for idx, line in enumerate(lines, 1):
        if not ("'" in line or '"' in line or "`" in line or ">" in line):
            continue

        for m in a_an_re.finditer(line):
            w1, w2 = m.group(1), m.group(2)
            if w2.lower() not in {"unique", "user", "users", "unit", "units", "universal", "one", "useful", "uniform"}:
                issues.append((filepath, idx, "A/AN", f"'{w1} {w2}' -> should probably be 'an {w2}'", line.strip()))

        for m in an_a_re.finditer(line):
            w1, w2 = m.group(1), m.group(2)
            if w2.lower() not in {"hour", "hours", "honest", "honor", "honorable", "heir"}:
                issues.append((filepath, idx, "AN/A", f"'{w1} {w2}' -> should probably be 'a {w2}'", line.strip()))

        if "Kimmy" in line and "Kimmi" not in line and "textNormalizer" not in filepath:
            if any(k in line for k in ['"', "'", "`", ">"]):
                issues.append((filepath, idx, "NAME_CONSISTENCY", "Found 'Kimmy' instead of canonical 'Kimmi'", line.strip()))

print(f"Total rule issues found: {len(issues)}")
for f, l, kind, msg, code in issues:
    print(f"[{kind}] {f}:{l} - {msg}\n  Line: {code}\n")
