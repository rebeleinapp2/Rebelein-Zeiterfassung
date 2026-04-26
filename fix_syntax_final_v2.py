import re

with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Identify where the main return ends
# It currently has a lot of extra </div> and then );

# Let's search for the end of the Permission Denied Modal
modal_end = """                            </button>
                        </GlassCard>
                    </div>
                )
            }"""

# We want the main div to close after this
# The return started with: <div className="p-6 pb-24 h-full overflow-y-auto w-full">

new_ending = modal_end + """
        </div>
    );
};

export default OfficeUserPage;"""

# We need to find the Permission Denied Modal and replace everything until the end of the file
idx = content.find('{/* Permission Denied Modal */}')
if idx != -1:
    content = content[:idx] + content[idx:].split('export default')[0] # approximate
    # Let's be more precise
    permission_modal_section = content[idx:]
    # Split by the end of the modal
    parts = re.split(re.escape(modal_end), permission_modal_section)
    if len(parts) > 1:
         content = content[:idx] + '{/* Permission Denied Modal */}\n            ' + parts[0] + new_ending
    else:
         print("Could not find modal_end")
else:
    print("Could not find permission modal comment")

with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Syntax fixed.")
