import sys

with open('pages/OfficeUserListPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Imports
content = content.replace("import React, { useEffect, useState, useMemo } from 'react';", 
"import React, { useEffect, useState, useMemo } from 'react';\nimport { motion, AnimatePresence } from 'framer-motion';\nimport { MotionNumber } from '../components/MotionNumber';")
content = content.replace("Eye, EyeOff, ArrowRight } from 'lucide-react';", "Eye, EyeOff, ArrowRight, Activity, Users } from 'lucide-react';")

# 2. Before return
bento_logic = """
    // --- BENTO GRID STATS ---
    const totalUsers = sortedUsers.length;
    const totalPendingEntries = sortedUsers.reduce((sum, u) => sum + getUserStats(u).pendingCount, 0);
    const totalPendingVacations = sortedUsers.reduce((sum, u) => sum + getUserStats(u).pendingRequestsCount, 0);
    
    const todayStr = getLocalISOString();
    const absentToday = sortedUsers.reduce((sum, u) => {
        const isAbsent = monthlyAbsences.some(a => a.user_id === u.user_id && a.start_date <= todayStr && a.end_date >= todayStr);
        return sum + (isAbsent ? 1 : 0);
    }, 0);

    const pageVariants = {
        initial: { opacity: 0 },
        animate: { 
            opacity: 1, 
            transition: { duration: 0.6, ease: 'easeOut', staggerChildren: 0.1, when: "beforeChildren" } 
        },
        exit: { opacity: 0, transition: { duration: 0.3 } }
    };

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1, delayChildren: 0.2 }
        }
    };

    return (
        <motion.div 
            className="h-full relative flex flex-col overflow-hidden bg-background"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
        >
            {/* Animated Background Blobs */}
            <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-teal-500/10 rounded-full blur-[120px] animate-blob" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px] animate-blob animation-delay-2000" />
            </div>

            <div className="relative z-10 flex-1 overflow-y-auto w-full scrollbar-thin pb-24">
                <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-8">
                    
                    {/* Header Area */}
                    <div className="relative overflow-hidden bg-card/50 backdrop-blur-sm border border-border rounded-3xl shadow-2xl p-6 md:p-10 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
                        <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 via-transparent to-transparent pointer-events-none" />
                        <div className="relative z-10 space-y-1">
                            <motion.div 
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.5 }}
                                className="flex items-center gap-2 text-teal-400 font-bold text-sm uppercase tracking-[0.2em]"
                            >
                                <Activity size={16} /> Office Dashboard
                            </motion.div>
                            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-foreground">
                                Mitarbeiter Übersicht
                            </h1>
                            <p className="text-muted-foreground text-lg font-medium opacity-80">
                                Status, Zeiten und Urlaube verwalten.
                            </p>
                        </div>
                        
                        <div className="relative z-10 flex items-center bg-muted border border-border rounded-2xl p-1.5 backdrop-blur-md">
                            <button onClick={prevMonth} className="p-3 hover:bg-card rounded-xl text-foreground transition-colors"><ChevronLeft size={24} /></button>
                            <span className="font-black text-foreground text-xl px-4 min-w-[160px] text-center">
                                {selectedDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                            </span>
                            <button onClick={nextMonth} className="p-3 hover:bg-card rounded-xl text-foreground transition-colors"><ChevronRight size={24} /></button>
                        </div>
                    </div>

                    {/* Bento Grid Stats */}
                    <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-4 grid-rows-2 gap-4 h-auto md:h-[240px]">
                        <motion.div 
                            variants={pageVariants} 
                            className="md:col-span-2 md:row-span-2 bg-card border border-border rounded-3xl shadow-xl p-8 flex flex-col justify-between group hover:border-teal-500/50 transition-all duration-500 overflow-hidden relative"
                        >
                            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                                <Users size={120} className="text-teal-400 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                            </div>
                            <div className="relative z-10">
                                <div className="w-14 h-14 rounded-2xl bg-teal-500/10 flex items-center justify-center text-teal-400 mb-4 shadow-inner">
                                    <Users size={32} />
                                </div>
                                <p className="text-sm text-muted-foreground uppercase tracking-widest font-black">Mitarbeiter gesamt</p>
                            </div>
                            <div className="relative z-10 text-7xl font-black text-foreground tracking-tighter">
                                <MotionNumber value={totalUsers} />
                            </div>
                        </motion.div>

                        <motion.div 
                            variants={pageVariants} 
                            className="md:col-span-1 bg-card border border-border rounded-3xl shadow-lg p-6 flex flex-col justify-between group hover:border-orange-500/50 transition-all duration-500"
                        >
                            <div className="flex items-center justify-between">
                                <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400 group-hover:scale-110 transition-transform">
                                    <AlertTriangle size={24} />
                                </div>
                                <div className="text-3xl font-black text-foreground">
                                    <MotionNumber value={totalPendingEntries} />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground uppercase tracking-widest font-black">Zu Bestätigen</p>
                        </motion.div>

                        <motion.div 
                            variants={pageVariants} 
                            className="md:col-span-1 bg-card border border-border rounded-3xl shadow-lg p-6 flex flex-col justify-between group hover:border-purple-500/50 transition-all duration-500"
                        >
                            <div className="flex items-center justify-between">
                                <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform">
                                    <Palmtree size={24} />
                                </div>
                                <div className="text-3xl font-black text-foreground">
                                    <MotionNumber value={totalPendingVacations} />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground uppercase tracking-widest font-black">Urlaubsanträge</p>
                        </motion.div>

                        <motion.div 
                            variants={pageVariants} 
                            className="md:col-span-2 bg-card border border-border rounded-3xl shadow-lg p-6 flex items-center gap-6 group hover:border-blue-500/50 transition-all duration-500 overflow-hidden relative"
                        >
                            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0 group-hover:rotate-12 transition-transform shadow-inner">
                                <Shield size={32} />
                            </div>
                            <div className="min-w-0 relative z-10">
                                <div className="text-4xl font-black text-foreground">
                                    <MotionNumber value={absentToday} />
                                </div>
                                <p className="text-xs text-muted-foreground uppercase tracking-widest font-black">Mitarbeiter abwesend heute</p>
                            </div>
                        </motion.div>
                    </motion.div>
"""

old_return = """    return (
        <div className="p-6 h-full overflow-y-auto md:max-w-7xl md:mx-auto w-full pb-24">

            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-200 to-emerald-400">
                        Mitarbeiter Übersicht
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">Status & Leistungen aller Mitarbeiter</p>
                </div>

                {/* Controls Group */}
                <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                    {/* Month Selector */}
                    <div className="flex items-center justify-between bg-muted border border-border rounded-xl p-1 backdrop-blur-md w-full md:w-auto min-w-[250px]">
                        <button onClick={prevMonth} className="p-2 hover:bg-card rounded-lg text-foreground transition-colors">
                            <ChevronLeft size={20} />
                        </button>
                        <span className="font-bold text-foreground text-lg">
                            {selectedDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                        </span>
                        <button onClick={nextMonth} className="p-2 hover:bg-card rounded-lg text-foreground transition-colors">
                            <ChevronRight size={20} />
                        </button>
                    </div>
                </div>
            </div>"""

content = content.replace(old_return, bento_logic)

# 3. We also need to add closing tags for <motion.div> replacing the </div> of the main container, just above ConfirmDialog.
old_end = """            <ConfirmDialog
                isOpen={confirmDialog.isOpen}"""
new_end = """                </div>
            </div>
            
            <ConfirmDialog
                isOpen={confirmDialog.isOpen}"""
content = content.replace(old_end, new_end)

# Also need to replace the final </div> of the component with </motion.div>
content = content.replace("</div>\n    );\n};\n\nexport default OfficeUserListPage;", "</motion.div>\n    );\n};\n\nexport default OfficeUserListPage;")

with open('pages/OfficeUserListPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

