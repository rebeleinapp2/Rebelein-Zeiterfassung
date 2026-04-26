with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Change main grid from 3 to 5 columns
content = content.replace(
    '<div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8 animate-in slide-in-from-bottom-4 duration-500">',
    '<div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-8 animate-in slide-in-from-bottom-4 duration-500">'
)

# 2. Change KPI section from col-span-2 to col-span-3 (60%)
content = content.replace(
    '<div className="col-span-1 xl:col-span-2">',
    '<div className="col-span-1 xl:col-span-3">'
)

# 3. Change Calendar section from col-span-1 to col-span-2 (40%)
# We need to find the calendar section.
# Original: {/* CALENDAR (Right 1/3) */}
#           <div className="col-span-1">
#           <div className="col-span-1 sticky top-6 z-10">

content = content.replace(
    '{/* CALENDAR (Right 1/3) */}\n                <div className="col-span-1">',
    '{/* CALENDAR (Right 2/5) */}\n                <div className="col-span-1 xl:col-span-2">'
)

# Cleanup the double col-span-1 if it exists
content = content.replace(
    '<div className="col-span-1 sticky top-6 z-10">',
    '<div className="sticky top-6 z-10">'
)

with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Grid ratio updated to 3:2 (KPI/Calendar)")
