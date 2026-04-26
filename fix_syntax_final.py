with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Let's check the end of the file
# It should end with
#     );
# };
# export default OfficeUserPage;

# We probably need more divs.
# Main return starts with a div.

# Let's count divs manually or just re-add the missing ones before the return ends.
# I'll just check the very end.

if content.count('<div') > content.count('</div'):
    diff = content.count('<div') - content.count('</div')
    print(f"Missing {diff} closing divs")
    # Add them before the last `);`
    last_semicolon = content.rfind(');')
    if last_semicolon != -1:
        content = content[:last_semicolon] + ("</div>" * diff) + "\n        " + content[last_semicolon:]

with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
