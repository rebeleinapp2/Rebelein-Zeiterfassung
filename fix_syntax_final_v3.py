with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add missing closing div for HERO SECTION
content = content.replace(
    """            </SpotlightCard>
        </div>

            {/* KANBAN TASKS */}""",
    """            </SpotlightCard>
        </div>
    </div>

            {/* KANBAN TASKS */}"""
)

with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Hero section closing div added.")
