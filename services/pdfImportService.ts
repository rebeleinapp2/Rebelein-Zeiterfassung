import * as pdfjsLib from 'pdfjs-dist';
import { supabase } from './supabaseClient';

// Worker Konfiguration für Vite
// Use CDN for production stability to avoid MIME type errors (application/octet-stream)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.530/pdf.worker.min.mjs';

export interface PdfAnalysisResult {
    success: boolean;
    orderNumber?: string;
    customerName?: string;
    hours?: number;
    date?: string;
    message: string;
}

export const analyzeMontagebericht = async (file: File): Promise<PdfAnalysisResult> => {
    try {
        // 1. Keyword des Users aus den Einstellungen holen
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Nicht eingeloggt");

        const { data: profile } = await supabase
            .from('user_settings')
            .select('invoice_keyword')
            .eq('user_id', user.id)
            .single();

        const keyword = profile?.invoice_keyword || 'Arbeitszeit'; // Fallback

        // 2. PDF Text extrahieren (Seite 1)
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;

        // Nur Seite 1
        const page = await pdf.getPage(1);
        const textContent = await page.getTextContent();

        // 2a. Text rekonstruieren mit Koordinaten (Y-Sortierung für korrekte Zeilen)
        const items = textContent.items as any[];

        // Gruppiere nach Y-Koordinate (mit Toleranz für leichte Versatze)
        const lines: { y: number, text: string }[] = [];
        const tolerance = 5; // Pixel Toleranz

        items.forEach(item => {
            const y = item.transform[5]; // transform[5] ist y-position
            const text = item.str.trim();
            if (!text) return;

            // Suche existierende Zeile
            const line = lines.find(l => Math.abs(l.y - y) < tolerance);
            if (line) {
                line.text += ' ' + text; // Anfügen (eigentlich müssten wir noch nach X sortieren, aber meist reicht Append für einfache Zeilen)
            } else {
                lines.push({ y, text });
            }
        });

        // Sortiere Zeilen von oben nach unten (PDF Koordinaten: 0,0 ist unten links -> Y descending)
        lines.sort((a, b) => b.y - a.y);

        const fullText = lines.map(l => l.text).join('\n');
        console.log("Structured PDF Text:", fullText);

        // 3. Daten Zeilenbasiert suchen

        // Auftragsnummer
        const orderMatch = fullText.match(/(\d{8})M26/);
        const orderNumber = orderMatch ? orderMatch[1] : '';

        // Kunde: Suche nach "Rechnungsanschrift:", dann nimm die nächsten Zeilen
        // Wir suchen den Index der Zeile mit "Rechnungsanschrift:"
        let customerName = '';
        const rechnungLineIdx = lines.findIndex(l => l.text.includes('Rechnungsanschrift:'));

        if (rechnungLineIdx !== -1 && rechnungLineIdx + 2 < lines.length) {
            // Zeile nach "Rechnungsanschrift:" ist oft Anrede (Frau/Herrn)
            // Zeile danach ist Name
            // Wir prüfen die folgenden Zeilen
            const line1 = lines[rechnungLineIdx + 1].text; // z.B. "Frau"
            const line2 = lines[rechnungLineIdx + 2].text; // z.B. "Grethlein"

            // Wenn Zeile 1 nur Anrede ist, nehmen wir Zeile 2 als Namen
            if (line1.match(/^(Frau|Herr|Herrn|Firma)$/i)) {
                customerName = line2;
            } else {
                // Falls Anrede + Name in einer Zeile (eher bei Firmen), nehmen wir Zeile 1
                // Aber entfernen Anrede
                customerName = line1.replace(/^(Frau|Herr|Herrn|Firma)\s+/i, '');
            }
        }

        // Cleanup
        customerName = customerName.replace(/Rechnungsanschrift:/gi, '').trim();
        if (customerName.includes("Rebelein")) customerName = customerName.split("Rebelein")[0].trim();
        // Aggressiver Cleanup: Falls "Stefan" am Ende steht (vom Header), weg damit
        customerName = customerName.replace(/\s+Stefan.*$/i, '').trim();

        // Stunden: Zeilenweise Suche
        // Suche Zeile die "Std" enthält UND (Keyword ODER "EIG*")
        let hours = 0;

        // Regex für Zahl am Zeilenanfang oder vor "Std"
        const hoursLineRegex = /(\d+[,.]\d{2})\s*Std/i;

        for (const line of lines) {
            if (hoursLineRegex.test(line.text)) {
                // Prüfen ob Keyword oder EIG* in der Zeile ist
                const hasKeyword = line.text.toLowerCase().includes(keyword.toLowerCase());
                const hasEig = line.text.includes('EIG*');

                if (hasKeyword || (keyword === 'Arbeitszeit' && hasEig)) {
                    const match = line.text.match(hoursLineRegex);
                    if (match) {
                        hours = parseFloat(match[1].replace(',', '.'));
                        break; // Ersten Treffer nehmen
                    }
                }
            }
        }

        if (hours === 0 && !orderNumber) {
            return { success: false, message: `Keine Daten für '${keyword}' gefunden.` };
        }

        return {
            success: true,
            orderNumber,
            customerName,
            hours,
            message: `Erkannt: ${hours} Std. | ${customerName}`
        };

    } catch (error: any) {
        console.error("PDF Error:", error);
        return { success: false, message: 'Fehler beim Lesen der Datei.' };
    }
};

export const uploadBackupFile = async (file: File) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Dateiname "sicher" machen
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${Date.now()}_${safeName}`;

        await supabase.storage
            .from('reports')
            .upload(`${user.id}/${fileName}`, file, {
                upsert: false
            });
    } catch (err) {
        console.error("Backup Upload failed:", err);
        // Kein Throw, damit der User nicht blockiert wird wenn "nur" Backup fehlschlägt
    }
};
