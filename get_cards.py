import re

with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = "{/* LEFT SIDE: INFO CARDS */}"
end_marker = "            {/* RIGHT SIDE: CALENDAR */}"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    with open('info_cards_dump.txt', 'w') as out:
        out.write(content[start_idx:end_idx])
    print("Dumped info cards to info_cards_dump.txt")
else:
    print("Markers not found.")
