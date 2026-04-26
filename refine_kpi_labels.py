with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    '>Überstunden</span>',
    '>Überstundenkonto</span>'
)
content = content.replace(
    '>Monatsbilanz (Laufend)</span>',
    '>Monatsbilanz</span>'
)

with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Labels refined.")
