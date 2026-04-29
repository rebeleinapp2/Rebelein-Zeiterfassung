import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from './supabaseClient';
import { VacationRequest, UserSettings } from '../types';

const logoRebelein = '/logo/Logo Rebelein.jpeg';

export const generateVacationRequestPDF = async (
    request: VacationRequest,
    userProfile: { display_name: string } | null,
    allUserRequests?: VacationRequest[],
    viewerSettings?: any,
    isCopy: boolean = false
) => {
    const doc = new jsPDF();

    // Helper to load image
    const loadImage = (src: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = src;
            img.onload = () => resolve(img);
            img.onerror = reject;
        });
    };

    try {
        if (logoRebelein) {
            await loadImage(logoRebelein).then(img => {
                doc.addImage(img, 'JPEG', 150, 10, 50, 25);
            }).catch(err => console.error("Logo load error", err));
        }
    } catch (e) { console.log("No logo"); }

    const reqDate = new Date(request.start_date);
    const reqYear = reqDate.getFullYear();

    // Fetch user settings if not provided
    let settings = viewerSettings;
    if (!settings) {
        const { data } = await supabase.from('user_settings').select('*').eq('user_id', request.user_id).maybeSingle();
        settings = data || { vacation_days_yearly: 30, vacation_days_carryover: 0 };
    }

    let yearlyQuota = settings.vacation_days_yearly || 30;
    // Fetch specific year quota (async)
    const { data: qData } = await supabase.from('yearly_vacation_quotas').select('total_days').eq('user_id', request.user_id).eq('year', reqYear).maybeSingle();
    if (qData) yearlyQuota = qData.total_days;

    const carryOver = settings.vacation_days_carryover || 0;
    const totalAvailable = yearlyQuota + carryOver;

    // Fetch all requests for this year if not provided
    let yearRequests = allUserRequests;
    if (!yearRequests) {
        const { data } = await supabase.from('vacation_requests').select('*').eq('user_id', request.user_id).neq('status', 'rejected');
        yearRequests = data || [];
    }

    // Filter and sort
    yearRequests = yearRequests.filter(r => {
        const rDate = new Date(r.start_date);
        return rDate.getFullYear() === reqYear && r.status !== 'rejected';
    }).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Find current request index
    const reqIndex = yearRequests.findIndex(r => r.id === request.id);
    const requestNumber = reqIndex + 1;

    let usedDaysBefore = 0;
    let currentRequestDays = 0;

    yearRequests.forEach((r, idx) => {
        if (idx <= reqIndex) {
            const start = new Date(r.start_date);
            const end = new Date(r.end_date);

            let days = 0;
            let d = new Date(start);
            while (d <= end) {
                const day = d.getDay();
                if (day !== 0 && day !== 6) days++;
                d.setDate(d.getDate() + 1);
            }

            if (idx === reqIndex) currentRequestDays = days;
            usedDaysBefore += days;
        }
    });

    const remaining = totalAvailable - usedDaysBefore;

    // Layout
    const headerColor = [20, 184, 166] as [number, number, number];

    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(...headerColor);
    doc.text("URLAUBSANTRAG", 20, 25);
    if (isCopy) {
        doc.setFontSize(14);
        doc.setTextColor(200, 50, 50);
        doc.text("(KOPIE)", 100, 25);
    }

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Nr.${requestNumber} / ${reqYear}`, 20, 32);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text("Rebelein GmbH", 20, 45);
    doc.setFont("helvetica", "normal");
    doc.text("Heizung - Sanitär - Solartechnik", 20, 50);

    doc.setDrawColor(200, 200, 200);
    doc.line(20, 55, 190, 55);

    doc.setFontSize(11);
    doc.text(`Antragsteller:`, 20, 70);
    doc.setFont("helvetica", "bold");
    doc.text(`${userProfile?.display_name || 'Unbekannt'}`, 50, 70);

    doc.setFont("helvetica", "normal");
    doc.text(`Erstellt am:`, 140, 70);
    doc.text(`${new Date().toLocaleDateString('de-DE')}`, 165, 70);

    autoTable(doc, {
        startY: 85,
        head: [['Zeitraum (Von - Bis)', 'Tage (Werktage)', 'Bemerkung']],
        body: [
            [
                `${new Date(request.start_date).toLocaleDateString('de-DE')}  -  ${new Date(request.end_date).toLocaleDateString('de-DE')}`,
                `${currentRequestDays}`,
                request.note || ''
            ]
        ],
        theme: 'grid',
        headStyles: { fillColor: headerColor, textColor: [255, 255, 255] },
        styles: { fontSize: 11, cellPadding: 4 }
    });

    // Vacation Account Box
    // @ts-ignore
    let yPos = doc.lastAutoTable.finalY + 15;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Urlaubskonto (Stand nach diesem Antrag):", 20, yPos);
    yPos += 5;

    autoTable(doc, {
        startY: yPos,
        head: [['Jahresurlaub', 'Übertrag VJ', 'Gesamtanspruch', `Verbraucht (inkl. Nr. ${requestNumber})`, 'Resturlaub']],
        body: [
            [
                `${yearlyQuota}`,
                `${carryOver}`,
                `${totalAvailable}`,
                `${usedDaysBefore}`,
                `${remaining}`
            ]
        ],
        theme: 'plain',
        headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', halign: 'center' },
        bodyStyles: { halign: 'center', fontSize: 10 },
        columnStyles: {
            4: { fontStyle: 'bold', textColor: remaining < 0 ? [200, 0, 0] : [0, 0, 0] }
        },
        tableLineColor: [200, 200, 200],
        tableLineWidth: 0.1,
    });

    // Signatures
    // @ts-ignore
    const finalY = doc.lastAutoTable.finalY + 30;

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text("Hinweis: Dieser Antrag gilt vorbehaltlich der Genehmigung durch die Geschäftsleitung.", 20, finalY - 15);

    const boxY = finalY;
    const boxHeight = 25;
    const boxWidth = 70;

    doc.setDrawColor(0, 0, 0);
    doc.setTextColor(0, 0, 0);

    // Employee
    doc.line(20, boxY + boxHeight, 20 + boxWidth, boxY + boxHeight);
    doc.setFontSize(9);
    doc.text("Datum, Unterschrift Mitarbeiter", 20, boxY + boxHeight + 5);

    // Boss
    doc.line(110, boxY + boxHeight, 110 + boxWidth, boxY + boxHeight);
    doc.text("Genehmigt: Geschäftsleitung", 110, boxY + boxHeight + 5);

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text("Stefan Rebelein Sanitär GmbH • Martin-Behaim-Straße 6 • 90765 Fürth – Stadeln", 105, 280, { align: 'center' });
    doc.text(`Antrag ID: ${request.id.substring(0, 8)}`, 105, 285, { align: 'center' });

    doc.save(`Urlaubsantrag_${userProfile?.display_name || 'MA'}_${request.start_date}${isCopy ? '_KOPIE' : ''}.pdf`);

    // --- UPDATE REQUEST WITH PRINT LOG ---
    if (!isCopy) {
        const viewerName = viewerSettings?.display_name || 'Unbekannt';
        const printLog = `[Gedruckt von ${viewerName} am ${new Date().toLocaleDateString('de-DE')} ${new Date().toLocaleTimeString('de-DE')}]`;

        const currentNote = request.note || '';
        const newNote = currentNote ? `${currentNote}\n${printLog}` : printLog;

        const { error } = await supabase
            .from('vacation_requests')
            .update({ note: newNote })
            .eq('id', request.id);

        if (!error) {
            // Use local reload or handle state update
            window.location.reload();
        }
    }
};
