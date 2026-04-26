with open('pages/EntryPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix indexing error
content = content.replace("ENTRY_TYPES_CONFIG[entry.type]", "ENTRY_TYPES_CONFIG[entry.type as keyof typeof ENTRY_TYPES_CONFIG]")

# 2. Add Hourglass to imports
if 'Hourglass' not in content:
    content = content.replace("from 'lucide-react';", ", Hourglass } from 'lucide-react';")

with open('pages/EntryPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed types and imports in EntryPage.tsx")
