with open('pages/OfficeUserListPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find("Content Grid")
print(content[idx:idx+1500])
