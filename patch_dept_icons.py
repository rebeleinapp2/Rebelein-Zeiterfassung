import sys

def main():
    try:
        with open('pages/OfficeUserListPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # 1. Add getDepartmentIcon helper function
    helper_code = """
    const getDepartmentIcon = (dept: Department, size = 20, className = "") => {
        if (dept.id === 'unassigned') return <AlertTriangle className={`text-amber-500 ${className}`} size={size} />;
        
        const label = (dept.label || '').toLowerCase();
        if (label.includes('büro')) return <Building className={`text-blue-500 ${className}`} size={size} />;
        if (label.includes('kundendienst') || label.includes('monteur')) return <Wrench className={`text-emerald-500 ${className}`} size={size} />;
        if (label.includes('baustelle') || label.includes('montage')) return <HardHat className={`text-orange-500 ${className}`} size={size} />;
        if (label.includes('azubi') || label.includes('lehrling')) return <GraduationCap className={`text-purple-500 ${className}`} size={size} />;
        if (label.includes('archiv')) return <Archive className={`text-slate-500 ${className}`} size={size} />;
        
        return <Briefcase className={`text-teal-500 ${className}`} size={size} />;
    };
"""
    
    insertion_point = "const navigate = useNavigate();"
    if insertion_point in content:
        content = content.replace(insertion_point, insertion_point + helper_code)
    
    # 2. Update the icon rendering in the map (Expanded state)
    old_icon_expanded = '{dept.id === \'unassigned\' ? <AlertTriangle className="text-amber-500" size={20} /> : <Briefcase className="text-teal-500" size={20} />}'
    new_icon_expanded = '{getDepartmentIcon(dept)}'
    content = content.replace(old_icon_expanded, new_icon_expanded)
    
    # 3. Update the icon rendering in the map (Collapsed state)
    # The collapsed state icon was slightly different in my previous patch
    old_icon_collapsed = '{dept.id === \'unassigned\' ? <AlertTriangle className="text-amber-500 group-hover:text-amber-400" size={20} /> : <Briefcase size={20} />}'
    new_icon_collapsed = '{getDepartmentIcon(dept, 20, "group-hover:opacity-80 transition-opacity")}'
    content = content.replace(old_icon_collapsed, new_icon_collapsed)

    with open('pages/OfficeUserListPage.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Department icons updated successfully!")

if __name__ == '__main__':
    main()
