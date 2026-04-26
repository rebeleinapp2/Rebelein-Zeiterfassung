import re
import sys

def main():
    try:
        with open('pages/OfficeUserPage.tsx', 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    # Markers for extraction
    markers = {
        'dashboard_header': '{/* NEW DASHBOARD HEADER */}',
        'permission_warning': '{/* PERMISSION WARNING */}',
        'kanban_tasks': '{/* KANBAN BOARD FOR TASKS */}',
        'info_cards_start': '<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8 w-full items-start">',
        'calendar_start': '{/* RIGHT SIDE: CALENDAR */}',
        'modals_start': '{/* MODALS BELOW */}'
    }

    indices = {}
    for key, marker in markers.items():
        idx = content.find(marker)
        if idx == -1:
            # Fallback for modal
            if key == 'modals_start':
                idx = content.find('{/* MODAL: Calendar Day Detail (RESTORED) */}')
            if idx == -1:
                print(f"Marker not found: {key}")
                sys.exit(1)
        indices[key] = idx

    header_to_permission = content[indices['dashboard_header']:indices['permission_warning']]
    permission_warning = content[indices['permission_warning']:indices['kanban_tasks']]
    kanban_tasks = content[indices['kanban_tasks']:indices['info_cards_start']]
    
    # We need to extract the logic from the old Info Cards
    info_cards = content[indices['info_cards_start']:indices['calendar_start']]
    
    calendar = content[indices['calendar_start']:indices['modals_start']]

    # We will build a NEW layout
    # 1. NEW DASHBOARD HEADER
    # 2. PERMISSION WARNING
    # 3. HERO GRID + CALENDAR:
    #    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 mb-8">
    #       <div className="col-span-1 xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
    #           {/* 6 KPI CARDS (NOT expandable, just numbers) */}
    #       </div>
    #       <div className="col-span-1">
    #           {/* CALENDAR */}
    #       </div>
    #    </div>
    # 4. KANBAN TASKS (Urlaube, Zeiten bestätigen)
    # 5. DETAILED SECTIONS (Urlaubsverwaltung Details, Arbeitszeit-Modell Details, Startsaldo Liste)

    # Let's extract the internals of the old info cards to make the new detailed sections.
    # The old info cards have a `collapsedTiles` logic. We will strip the collapsed condition and just show the detailed part.
    
    # We will just write a patch to replace everything from `dashboard_header` to `modals_start`.

    new_layout = """
            {/* NEW DASHBOARD HEADER */}
            <div className="mb-6 animate-in slide-in-from-top-4 duration-500">
                <button onClick={() => navigate('/office/users')} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-4 text-sm font-bold uppercase tracking-wider">
                    <ChevronLeft size={16} /> Zurück zur Übersicht
                </button>
                <div className="flex items-center gap-3 mb-2 text-primary font-bold uppercase tracking-widest text-xs">
                    <PartyPopper size={16} /> Mitarbeiter Dashboard
                </div>
                <h1 className="text-3xl md:text-4xl font-black text-foreground tracking-tighter leading-tight flex items-center gap-3 flex-wrap">
                    <span>Profil von <span className="text-primary">{currentUser?.display_name || 'Benutzer'}</span></span>
                    {currentUser?.is_active === false && (
                        <span className="flex items-center gap-1 text-sm border border-red-500/50 bg-red-500/20 text-red-300 px-3 py-1 rounded-full uppercase tracking-wider font-bold">
                            <Ban size={14} /> Deaktiviert
                        </span>
                    )}
                </h1>
                <p className="mt-2 text-muted-foreground text-sm">
                    Verwalte Zeiten, Urlaube und Modelle mit Präzision.
                </p>
            </div>

            {/* PERMISSION WARNING */}
""" + permission_warning[len('{/* PERMISSION WARNING */}'):] + """

            {/* HERO SECTION: KPI GRID + CALENDAR */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8 animate-in slide-in-from-bottom-4 duration-500">
                
                {/* KPI GRID (Left 2/3) */}
                <div className="col-span-1 xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Überstunden */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-emerald-500/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Scale size={80} className="text-emerald-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-inner">
                                <Clock size={16} />
                            </div>
                            <span className="text-emerald-500 font-black uppercase tracking-widest text-xs">Überstunden</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className={`text-4xl font-black tracking-tighter leading-none ${totalBalanceStats.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {totalBalanceStats.diff > 0 ? '+' : ''}{totalBalanceStats.diff.toFixed(2)}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">Std</span>
                        </div>
                    </SpotlightCard>

                    {/* Urlaubsverwaltung */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-purple-500/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Palmtree size={80} className="text-purple-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500 shadow-inner">
                                <Palmtree size={16} />
                            </div>
                            <span className="text-purple-500 font-black uppercase tracking-widest text-xs">Urlaubsverwaltung</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className="text-4xl font-black tracking-tighter text-foreground">
                                {takenVacationDays.toFixed(1)}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">/ {effectiveVacationClaim.toFixed(1)} Tage</span>
                        </div>
                    </SpotlightCard>

                    {/* Arbeitszeit-Modell */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-blue-500/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Briefcase size={80} className="text-blue-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-inner">
                                <Briefcase size={16} />
                            </div>
                            <span className="text-blue-500 font-black uppercase tracking-widest text-xs">Arbeitszeit-Modell</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className="text-4xl font-black tracking-tighter text-blue-400">
                                {dayIndices.reduce((sum, d) => sum + (Number(workModelTargets[d]) || 0), 0).toLocaleString('de-DE', { maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">h / Woche</span>
                        </div>
                    </SpotlightCard>

                    {/* Anwesenheit */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-blue-500/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <UserCheck size={80} className="text-blue-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-inner">
                                <UserCheck size={16} />
                            </div>
                            <span className="text-blue-500 font-black uppercase tracking-widest text-xs">Anwesenheit (Monat)</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className="text-4xl font-black tracking-tighter text-blue-400">
                                {formatDuration(monthlyAttendance)}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">h</span>
                        </div>
                    </SpotlightCard>

                    {/* Startsaldo */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-cyan-500/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Calculator size={80} className="text-cyan-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-500 shadow-inner">
                                <Calculator size={16} />
                            </div>
                            <span className="text-cyan-500 font-black uppercase tracking-widest text-xs">Startsaldo / Übertrag</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className="text-4xl font-black tracking-tighter text-cyan-400">
                                {balanceEntries.reduce((sum, e) => sum + e.hours, 0).toFixed(2)}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">h</span>
                        </div>
                    </SpotlightCard>

                    {/* Monatsbilanz */}
                    <SpotlightCard className="bg-card border border-border p-5 rounded-2xl flex flex-col justify-between transition-all duration-500 hover:border-teal-500/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-5 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Scale size={80} className="text-teal-500 rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                        </div>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-8 h-8 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-500 shadow-inner">
                                <Scale size={16} />
                            </div>
                            <span className="text-teal-500 font-black uppercase tracking-widest text-xs">Monatsbilanz (Laufend)</span>
                        </div>
                        <div className="flex items-baseline gap-2 relative z-10">
                            <span className={`text-4xl font-black tracking-tighter ${monthlyStats.diff >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                                {monthlyStats.diff > 0 ? '+' : ''}{monthlyStats.diff.toFixed(2)}
                            </span>
                            <span className="text-sm text-muted-foreground font-bold">h</span>
                        </div>
                    </SpotlightCard>

                </div>

                {/* CALENDAR (Right 1/3) */}
                <div className="col-span-1">
""" + calendar[len('{/* RIGHT SIDE: CALENDAR */}'):] + """
            </div>

            {/* KANBAN TASKS */}
""" + kanban_tasks[len('{/* KANBAN BOARD FOR TASKS */}'):] + """

            {/* DETAILED SECTIONS */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-8 animate-in slide-in-from-bottom-6 duration-700">
                
                {/* URLAUBSVERWALTUNG DETAILS */}
                <div className="bg-card/50 border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-lg relative overflow-hidden group">
                    <div className="flex items-center justify-between pb-3 border-b border-purple-500/20 mb-2 relative z-10">
                        <h2 className="text-xl font-black flex items-center gap-2 text-purple-400">
                            <Palmtree size={24} /> Urlaubsverwaltung Details
                        </h2>
                        <div className="flex items-center bg-background/80 rounded-xl px-2 py-1 gap-2 border border-border shadow-inner">
                            <button onClick={() => setVacationViewYear(y => y - 1)} className="text-purple-300 hover:text-foreground p-1 transition-colors"><ChevronLeft size={16} /></button>
                            <span className="text-sm font-black text-foreground w-10 text-center">{vacationViewYear}</span>
                            <button onClick={() => setVacationViewYear(y => y + 1)} className="text-purple-300 hover:text-foreground p-1 transition-colors"><ChevronRight size={16} /></button>
                        </div>
                    </div>
                    
                    <div className="flex flex-col relative z-10">
                        {unpaidDaysInYear > 0 && (
                            <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-500/20 rounded-xl text-sm text-red-200 flex items-start gap-3 shadow-inner">
                                <Info size={18} className="mt-0.5 shrink-0 text-red-400" />
                                <div>
                                    <span className="font-bold block mb-1">{unpaidDaysInYear} Tage Unbezahlt.</span>
                                    <p className="opacity-80 text-xs">Der Urlaubsanspruch wurde automatisch um {(vacationDaysEdit! - effectiveVacationClaim).toFixed(1)} Tage reduziert.</p>
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-between bg-muted/50 p-4 rounded-2xl border border-border/50 mb-6">
                            <div className="flex flex-col gap-1 w-full max-w-[80px]">
                                <label className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">Basis</label>
                                <input
                                    type="number"
                                    disabled={isQuotaLocked}
                                    value={vacationDaysEdit ?? ''}
                                    onChange={e => {
                                        const val = parseFloat(e.target.value);
                                        setVacationDaysEdit(isNaN(val) ? 0 : val);
                                    }}
                                    className={`w-full bg-background border border-border rounded-lg px-2 py-2 text-center text-sm font-bold text-foreground focus:outline-none ${isQuotaLocked ? 'opacity-50 cursor-not-allowed' : 'focus:border-purple-500/50'}`}
                                />
                            </div>
                            <div className="text-muted-foreground font-black text-xl">+</div>
                            <div className="flex flex-col gap-1 w-full max-w-[80px]">
                                <label className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">Rest (VJ)</label>
                                <input
                                    type="number"
                                    disabled={isQuotaLocked}
                                    value={vacationCarryoverEdit ?? ''}
                                    onChange={e => {
                                        const val = parseFloat(e.target.value);
                                        setVacationCarryoverEdit(isNaN(val) ? 0 : val);
                                    }}
                                    className={`w-full bg-background border border-border rounded-lg px-2 py-2 text-center text-sm font-bold text-foreground focus:outline-none ${isQuotaLocked ? 'opacity-50 cursor-not-allowed' : 'focus:border-purple-500/50'}`}
                                />
                            </div>
                            <div className="text-muted-foreground font-black text-xl">=</div>
                            <div className="flex flex-col items-end gap-1">
                                <label className="text-[10px] text-muted-foreground uppercase font-black tracking-wider">Gesamt</label>
                                <span className="text-2xl font-black text-purple-400">
                                    {((vacationDaysEdit || 0) + (vacationCarryoverEdit || 0)).toFixed(1)}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center justify-between mb-6">
                            <button
                                onClick={() => {
                                    if (userId) {
                                        supabase.from('yearly_vacation_quotas')
                                            .select('id')
                                            .eq('user_id', userId)
                                            .eq('year', vacationViewYear)
                                            .single()
                                            .then(({ data }) => {
                                                if (data) {
                                                    fetchVacationAuditLog(data.id).then(setQuotaAuditLogs);
                                                    setShowQuotaHistory(true);
                                                } else {
                                                    showToast("Keine Historie vorhanden.", "warning");
                                                }
                                            });
                                    }
                                }}
                                className="px-4 py-2 bg-background border border-border hover:bg-muted rounded-xl text-muted-foreground hover:text-foreground text-xs font-bold transition-colors flex items-center gap-2"
                            >
                                <HistoryIcon size={14} /> Quoten-Historie
                            </button>

                            <div className="flex gap-2">
                                <button
                                    onClick={() => setIsQuotaLocked(!isQuotaLocked)}
                                    className={`p-2 rounded-xl transition-colors flex items-center justify-center ${isQuotaLocked ? 'bg-muted text-muted-foreground hover:text-foreground' : 'bg-orange-500/20 text-orange-200 hover:bg-orange-500/30'}`}
                                    title={isQuotaLocked ? "Entsperren zum Bearbeiten" : "Bearbeitung sperren"}
                                >
                                    {isQuotaLocked ? <Lock size={16} /> : <Unlock size={16} />}
                                </button>

                                {!isQuotaLocked && (
                                    <button
                                        onClick={() => {
                                            const role = viewerSettings?.role;
                                            if (role !== 'super_admin' && role !== 'admin' && role !== 'office' && (role as string) !== 'chef') {
                                                setShowPermissionError(true);
                                                return;
                                            }

                                            if (userId && vacationDaysEdit !== null) {
                                                updateYearlyQuota(userId, vacationViewYear, {
                                                    total_days: vacationDaysEdit,
                                                    manual_carryover: vacationCarryoverEdit,
                                                    is_locked: true
                                                });
                                                setIsQuotaLocked(true);
                                                setTimeout(async () => {
                                                    const notifs = await fetchQuotaNotifications(userId);
                                                    if (notifs) setQuotaNotifications(notifs);
                                                }, 500);
                                            }
                                        }}
                                        className="px-4 py-2 bg-purple-500 hover:bg-purple-600 rounded-xl text-foreground text-xs font-bold transition-colors flex items-center gap-2 shadow-lg shadow-purple-900/20"
                                    >
                                        <Save size={16} /> {quotaNotifications.some(n => n.status === 'pending') ? 'Vorschlag aktualisieren' : 'Speichern'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* APPROVED REQUESTS SUB-SECTION */}
                        {canManage && approvedRequests.length > 0 && (
                            <div className="pt-4 border-t border-border/50">
                                <label className="text-[10px] uppercase font-bold text-emerald-400/70 mb-3 flex items-center gap-2">
                                    <CheckCircle size={14} /> Genehmigte Urlaubsanträge (Letzte 5)
                                </label>
                                <div className="space-y-2 max-h-40 overflow-y-auto scrollbar-thin">
                                    {approvedRequests.map(req => (
                                        <div key={req.id} className="bg-emerald-500/5 p-3 rounded-xl border border-emerald-500/10 flex items-center justify-between gap-2">
                                            <div>
                                                <div className="font-bold text-foreground text-sm">
                                                    {new Date(req.start_date).toLocaleDateString('de-DE')} - {new Date(req.end_date).toLocaleDateString('de-DE')}
                                                </div>
                                                <div className="text-emerald-200/50 text-[10px] mt-0.5">
                                                    {new Date(req.created_at).toLocaleDateString('de-DE')} • {req.approved_by_name || 'Admin'}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => generateVacationRequestPDF(req, true)}
                                                className="px-3 py-1.5 bg-background border border-border rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-bold transition-colors flex items-center gap-2"
                                                title="Kopie drucken"
                                            >
                                                <Printer size={12} /> Drucken
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ARBEITSZEIT-MODELL DETAILS */}
                <div className="bg-card/50 border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-lg relative overflow-hidden">
                    <div className="flex items-center justify-between pb-3 border-b border-blue-500/20 mb-2 relative z-10">
                        <h2 className="text-xl font-black flex items-center gap-2 text-blue-400">
                            <Briefcase size={24} /> Arbeitszeit-Modell Details
                        </h2>
                        <div className="flex items-center gap-2">
                            {isEditingWorkModel ? (
                                <>
                                    <button onClick={() => setIsEditingWorkModel(false)} className="p-2 bg-background hover:bg-muted border border-border rounded-xl text-muted-foreground transition-colors"><RotateCcw size={16} /></button>
                                    <button onClick={handleSaveWorkModel} className="p-2 bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 rounded-xl transition-colors"><Save size={16} /></button>
                                </>
                            ) : (
                                <>
                                    <button onClick={handleToggleLock} className="p-2 bg-background hover:bg-muted border border-border rounded-xl transition-colors" title={isWorkModelLocked ? "Entsperren" : "Sperren"}>
                                        {isWorkModelLocked ? <Lock size={16} className="text-red-400" /> : <Unlock size={16} className="text-emerald-400" />}
                                    </button>
                                    <button 
                                        onClick={() => !isWorkModelLocked && setIsEditingWorkModel(true)} 
                                        className={`p-2 rounded-xl transition-colors border border-border ${isWorkModelLocked ? 'bg-background opacity-50 cursor-not-allowed text-muted-foreground' : 'bg-background hover:bg-blue-500/10 text-blue-400 hover:border-blue-500/30'}`} 
                                        disabled={isWorkModelLocked}
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col relative z-10">
                        <div className="grid grid-cols-3 gap-4 mb-2 px-4">
                            <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">Wochentag</span>
                            <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground text-center">Arbeitsbeginn</span>
                            <span className="text-[10px] uppercase font-black tracking-widest text-muted-foreground text-right">Soll-Stunden</span>
                        </div>
                        <div className="bg-background/80 rounded-2xl border border-border/50 overflow-hidden mb-6">
                            {dayIndices.map((d, i) => {
                                const target = workModelTargets[d] || 0;
                                const start = workModelConfig[d] || "07:00";
                                return (
                                    <div key={d} className={`grid grid-cols-3 gap-4 items-center px-4 py-3 border-b border-border/50 last:border-0 ${isEditingWorkModel ? 'bg-card/50' : ''}`}>
                                        <span className={`text-sm font-black uppercase tracking-wider ${d === 0 || d === 6 ? 'text-red-400/80' : 'text-foreground'}`}>{dayNames[i]}</span>
                                        {isEditingWorkModel ? (
                                            <>
                                                <input type="time" value={start} onChange={e => handleWorkModelConfigChange(d, e.target.value)} className="bg-background text-foreground text-sm font-mono rounded-lg px-3 py-1.5 text-center border border-blue-500/30 w-full focus:ring-1 focus:ring-blue-500 outline-none" />
                                                <input type="number" value={target} onChange={e => handleWorkModelTargetChange(d, e.target.value)} className="bg-background text-foreground text-sm font-mono rounded-lg px-3 py-1.5 text-right border border-blue-500/30 w-full focus:ring-1 focus:ring-blue-500 outline-none" />
                                            </>
                                        ) : (
                                            <>
                                                <span className="text-sm font-mono text-muted-foreground text-center">{start}</span>
                                                <span className={`text-sm font-mono text-right font-bold ${target > 0 ? 'text-foreground' : 'text-muted-foreground/50'}`}>{target > 0 ? `${target} h` : '-'}</span>
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/30 p-4 rounded-2xl border border-border/50">
                            {/* Employment Start Date */}
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Eintrittsdatum</span>
                                {isEditingWorkModel ? (
                                    <input
                                        type="date"
                                        value={employmentStartDateEdit}
                                        onChange={(e) => setEmploymentStartDateEdit(e.target.value)}
                                        className="bg-background border border-blue-500/30 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                ) : (
                                    <div className="text-sm font-bold text-foreground bg-background px-3 py-2 rounded-lg border border-border">
                                        {employmentStartDateEdit ? new Date(employmentStartDateEdit).toLocaleDateString('de-DE') : 'Nicht gesetzt'}
                                    </div>
                                )}
                            </div>

                            {/* Confirmation Toggle */}
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Bestätigungspflicht</span>
                                {isEditingWorkModel ? (
                                    <button
                                        onClick={() => setWorkModelConfirmation(!workModelConfirmation)}
                                        className={`w-14 h-7 rounded-full p-1 transition-all ${workModelConfirmation ? 'bg-blue-500 justify-end' : 'bg-muted border border-border justify-start'} flex items-center`}
                                    >
                                        <div className="w-5 h-5 rounded-full bg-white shadow-sm" />
                                    </button>
                                ) : (
                                    <div className={`text-sm font-bold px-3 py-2 rounded-lg border ${workModelConfirmation ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-background text-muted-foreground border-border'}`}>
                                        {workModelConfirmation ? 'Aktiv' : 'Inaktiv'}
                                    </div>
                                )}
                            </div>

                            {/* Visibility Toggle */}
                            <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Sichtbarkeit</span>
                                {isEditingWorkModel ? (
                                    <button
                                        onClick={() => setVisibleToOthers(!visibleToOthers)}
                                        className={`w-14 h-7 rounded-full p-1 transition-all ${visibleToOthers ? 'bg-emerald-500 justify-end' : 'bg-muted border border-border justify-start'} flex items-center`}
                                    >
                                        <div className="w-5 h-5 rounded-full bg-white shadow-sm" />
                                    </button>
                                ) : (
                                    <div className={`text-sm font-bold px-3 py-2 rounded-lg border ${visibleToOthers ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-background text-muted-foreground border-border'}`}>
                                        {visibleToOthers ? 'Sichtbar' : 'Versteckt'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {isEditingWorkModel && (
                            <div className="mt-4 text-xs font-bold text-blue-400 bg-blue-500/10 px-4 py-3 rounded-xl border border-blue-500/20 flex items-center gap-2 animate-pulse">
                                <Unlock size={16} /> Bearbeitungsmodus ist aktiv
                            </div>
                        )}
                    </div>
                </div>

                {/* STARTSALDO / ÜBERTRAG DETAILS */}
                <div className="bg-card/50 border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-lg relative overflow-hidden lg:col-span-2 xl:col-span-2">
                    <div className="flex items-center justify-between pb-3 border-b border-cyan-500/20 mb-2 relative z-10">
                        <h2 className="text-xl font-black flex items-center gap-2 text-cyan-400">
                            <Calculator size={24} /> Startsaldo & Historie
                        </h2>
                        <div className="bg-cyan-500/10 text-cyan-400 text-sm font-black px-3 py-1 rounded-xl border border-cyan-500/20">
                            {balanceEntries.reduce((sum, e) => sum + e.hours, 0).toFixed(2)} h Gesamt
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                        <div className="flex flex-col max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                            <label className="text-[10px] uppercase font-bold text-muted-foreground mb-3">Buchungs-Historie</label>
                            {balanceEntries.length === 0 ? (
                                <p className="text-sm text-muted-foreground italic bg-background/50 p-4 rounded-xl border border-border">Keine manuellen Überträge vorhanden.</p>
                            ) : (
                                <div className="space-y-2">
                                    {balanceEntries.map(entry => (
                                        <div key={entry.id} className="bg-cyan-500/5 p-4 rounded-xl border border-cyan-500/10 flex items-center justify-between">
                                            <div>
                                                <div className="text-sm text-foreground italic mb-1">"{entry.reason}"</div>
                                                <div className="text-[10px] text-muted-foreground font-bold uppercase">
                                                    {entry.created_at ? new Date(entry.created_at).toLocaleDateString('de-DE') : '-'}
                                                </div>
                                            </div>
                                            <div className={`text-lg font-black tracking-wider ${entry.hours >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
                                                {entry.hours > 0 ? '+' : ''}{entry.hours.toFixed(2)} h
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {canManage && (currentUser?.role === 'admin' || viewerSettings?.role === 'admin') && (
                            <div className="bg-background/80 p-5 rounded-2xl border border-border flex flex-col justify-center h-full">
                                <div className="text-xs uppercase font-black tracking-wider text-cyan-400 mb-4 flex items-center gap-2"><PlusCircle size={16}/> Neuer Übertrag</div>
                                <div className="flex flex-col gap-3">
                                    <div className="flex gap-3">
                                        <GlassInput
                                            type="number"
                                            placeholder="Std (z.B. -10 oder 5.5)"
                                            value={balanceForm.hours}
                                            onChange={e => setBalanceForm({ ...balanceForm, hours: e.target.value })}
                                            className="w-1/3 !py-2 !px-4 !text-sm text-center font-bold"
                                        />
                                        <GlassInput
                                            type="text"
                                            placeholder="Begründung für die Buchung..."
                                            value={balanceForm.reason}
                                            onChange={e => setBalanceForm({ ...balanceForm, reason: e.target.value })}
                                            className="w-2/3 !py-2 !px-4 !text-sm"
                                        />
                                    </div>
                                    <button
                                        disabled={!balanceForm.hours || !balanceForm.reason}
                                        onClick={async () => {
                                            const h = parseFloat(balanceForm.hours);
                                            if (isNaN(h)) return;
                                            await addBalanceEntry(h, balanceForm.reason);
                                            setBalanceForm({ hours: '', reason: '' });
                                        }}
                                        className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-background text-sm font-black tracking-wider uppercase rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-cyan-900/20 mt-2 flex justify-center items-center gap-2"
                                    >
                                        <Save size={16}/> Buchen
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
"""

    # Add the missing PlusCircle to imports
    content = content.replace("Scale,", "Scale, PlusCircle,")
    if "PlusCircle," not in content:
        content = content.replace("from 'lucide-react';", "PlusCircle } from 'lucide-react';")

    new_content = content[:indices['dashboard_header']] + new_layout + content[indices['modals_start']:]

    with open('pages/OfficeUserPage.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Dashboard refactored!")

if __name__ == '__main__':
    main()
