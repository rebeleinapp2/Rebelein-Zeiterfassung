import re
import sys

def main():
    try:
        with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # Define markers
    markers = {
        'overtime': '{/* OVERTIME ACCOUNT / LIFETIME BALANCE */}',
        'startsaldo': '{/* INITIAL BALANCE / TRANSFER (MULTI-ENTRY) */}',
        'work_model': '{/* WORK MODEL CONFIG (SIMPLE) */}',
        'vacation': '{/* Vacation Mgmt */}',
        'attendance': '{/* Monthly Attendance Tile */}',
        'monthly_balance': '{/* NEW: MONTHLY BALANCE TILE */}',
        'end': '                </SpotlightCard>\n                </div>\n            </div>\n\n                {/* RIGHT SIDE: CALENDAR */}'
    }

    # Find indices
    indices = {}
    for key, marker in markers.items():
        idx = content.find(marker)
        if idx == -1 and key != 'end':
            # Fallback for vacation mgmt
            if key == 'vacation':
                marker = '{/* Vacation Mgmt */}'
                idx = content.find(marker)
            if idx == -1:
                print(f"Marker not found: {key}")
                sys.exit(1)
        indices[key] = idx

    # We also need the split div that separates col 1 and col 2
    # It looks like: </div><div className="flex flex-col gap-6 w-full">
    split_marker = '</div><div className="flex flex-col gap-6 w-full">'
    split_idx = content.find(split_marker)
    if split_idx == -1:
        print("Split marker not found")
        sys.exit(1)

    # Extract blocks
    # Block order currently:
    # Col 1: overtime -> startsaldo
    # Col 2: work_model -> vacation -> attendance -> monthly_balance

    # Overtime block (from overtime to startsaldo)
    overtime_block = content[indices['overtime']:indices['startsaldo']]
    
    # Startsaldo block (from startsaldo to split_idx)
    startsaldo_block = content[indices['startsaldo']:split_idx]

    # Work model block (from work_model to vacation)
    work_model_block = content[indices['work_model']:indices['vacation']]

    # Vacation block (from vacation to attendance)
    vacation_block = content[indices['vacation']:indices['attendance']]

    # Attendance block (from attendance to monthly_balance)
    attendance_block = content[indices['attendance']:indices['monthly_balance']]

    # Monthly balance block (from monthly_balance to end)
    monthly_balance_block = content[indices['monthly_balance']:indices['end']]

    # Check for anomalies
    print("Extracted all blocks successfully.")

    # Reconstruct Layout
    # Column 1: Überstunden, then a grid with Anwesenheit and Startsaldo
    # Column 2: Urlaubsverwaltung, Arbeitszeit-Modell, Monatsbilanz

    # Fix the wrapper of Anwesenheit & Startsaldo: they should be side-by-side in Col 1
    # We will wrap them in `<div className="grid grid-cols-2 gap-6 w-full">`
    col_1_new = (
        overtime_block +
        '<div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">\n' +
        attendance_block +
        startsaldo_block +
        '</div>\n'
    )

    col_2_new = (
        vacation_block +
        work_model_block +
        monthly_balance_block
    )

    # Reassemble the entire section
    # Find the start of the columns wrapper: `<div className="col-span-1 lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">`
    wrapper_start = '<div className="col-span-1 lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">'
    wrapper_start_idx = content.find(wrapper_start)

    # And the first flex col: `<div className="flex flex-col gap-6 w-full">`
    first_col_start = '<div className="flex flex-col gap-6 w-full">'
    first_col_start_idx = content.find(first_col_start, wrapper_start_idx)

    prefix = content[:first_col_start_idx + len(first_col_start) + 1]
    suffix = content[indices['end']:]

    new_content = (
        prefix +
        col_1_new +
        split_marker + '\n' +
        col_2_new +
        suffix
    )

    with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)

    print("Layout rearranged successfully!")

if __name__ == '__main__':
    main()
