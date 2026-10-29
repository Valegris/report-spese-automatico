/**
 * Report settimanale delle spese: Google Sheets -> mail
 *
 * Ogni lunedi' lo script:
 *  1. legge il foglio "Spese" (Data | Categoria | Descrizione | Importo)
 *  2. somma le spese degli ultimi 7 giorni, in totale e per categoria
 *  3. invia il riepilogo SOLO all'account che possiede lo script
 *  4. segnala le righe non valide (data o importo errati) invece di ignorarle in silenzio
 *  5. scrive una riga nel foglio "Log"
 *
 * Tutti i dati di esempio sono inventati (vedi generaDatiEsempio).
 */

// ---------------------------------------------------------------- CONFIG
const CONFIG = {
  FOGLIO_SPESE: 'Spese',
  FOGLIO_LOG: 'Log',
  GIORNI: 7,
};

// ------------------------------------------------------------ FUNZIONE PRINCIPALE
function inviaReportSettimanale() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const utente = Session.getEffectiveUser().getEmail();
  try {
    const foglio = ss.getSheetByName(CONFIG.FOGLIO_SPESE);
    if (!foglio) throw new Error('Foglio "' + CONFIG.FOGLIO_SPESE + '" non trovato');

    const fine = inizioGiorno_(new Date(), 0);
    const inizio = inizioGiorno_(new Date(), -(CONFIG.GIORNI - 1));
    const righe = foglio.getDataRange().getValues().slice(1); // salta l'intestazione
    const r = calcolaRiepilogo_(righe, inizio, fine);

    const periodo = formatData_(inizio) + ' - ' + formatData_(fine);
    MailApp.sendEmail({
      to: utente, // destinatario fisso: lo script non puo' inviare dati a terzi
      subject: 'Report spese ' + periodo,
      body: costruisciTesto_(r, periodo),
      htmlBody: costruisciHtml_(r, periodo),
    });

    scriviLog_(ss, utente, 'REPORT_INVIATO',
      'righe valide: ' + r.conteggio + ', scartate: ' + r.scartate);
  } catch (e) {
    scriviLog_(ss, utente, 'ERRORE', e.message);
    throw e; // cosi' l'errore compare anche in "Esecuzioni"
  }
}

// ------------------------------------------------------------ CALCOLO (funzione "pura", testabile)
// righe: [data, categoria, descrizione, importo]. Lavora in CENTESIMI (numeri interi)
// per evitare gli errori di arrotondamento dei decimali (0.1 + 0.2 != 0.3).
function calcolaRiepilogo_(righe, inizio, fine) {
  const fineEsclusa = new Date(fine.getFullYear(), fine.getMonth(), fine.getDate() + 1);
  const out = { totale: 0, perCategoria: {}, conteggio: 0, scartate: 0 };

  righe.forEach(r => {
    if (r.every(c => c === '' || c === null)) return; // riga vuota: non conta come errore
    const [data, categoria, , importo] = r;
    const dataValida = data instanceof Date && !isNaN(data.getTime());
    const importoValido = typeof importo === 'number' && isFinite(importo);
    if (!dataValida || !importoValido) { out.scartate++; return; }
    if (data < inizio || data >= fineEsclusa) return; // fuori periodo

    const cent = Math.round(importo * 100);
    const cat = String(categoria || '').trim() || 'Senza categoria';
    out.totale += cent;
    out.conteggio++;
    out.perCategoria[cat] = (out.perCategoria[cat] || { cent: 0, n: 0 });
    out.perCategoria[cat].cent += cent;
    out.perCategoria[cat].n++;
  });
  return out;
}

// ------------------------------------------------------------ TESTO DELLA MAIL
function costruisciTesto_(r, periodo) {
  const righe = ['Report spese ' + periodo, ''];
  Object.keys(r.perCategoria).sort().forEach(cat => {
    righe.push('- ' + cat + ': ' + formatEuro_(r.perCategoria[cat].cent) +
      ' (' + r.perCategoria[cat].n + ' voci)');
  });
  righe.push('', 'TOTALE: ' + formatEuro_(r.totale) + ' su ' + r.conteggio + ' voci');
  if (r.scartate > 0) {
    righe.push('', 'ATTENZIONE: ' + r.scartate + ' righe scartate perche\' data o importo non validi. ' +
      'Controllale nel foglio: il totale potrebbe non essere completo.');
  }
  return righe.join('\n');
}

function costruisciHtml_(r, periodo) {
  const celle = Object.keys(r.perCategoria).sort().map(cat =>
    '<tr><td>' + escapeHtml_(cat) + '</td><td style="text-align:right">' +
    formatEuro_(r.perCategoria[cat].cent) + '</td><td style="text-align:right">' +
    r.perCategoria[cat].n + '</td></tr>').join('');
  const avviso = r.scartate > 0
    ? '<p style="color:#b00020"><b>Attenzione:</b> ' + r.scartate +
      ' righe scartate (data o importo non validi). Il totale potrebbe non essere completo.</p>'
    : '';
  return '<h3>Report spese ' + escapeHtml_(periodo) + '</h3>' +
    '<table cellpadding="6" style="border-collapse:collapse">' +
    '<tr><th align="left">Categoria</th><th align="right">Importo</th><th align="right">Voci</th></tr>' +
    celle +
    '<tr><td><b>Totale</b></td><td style="text-align:right"><b>' + formatEuro_(r.totale) +
    '</b></td><td style="text-align:right"><b>' + r.conteggio + '</b></td></tr></table>' + avviso;
}

// ------------------------------------------------------------ UTILITA'
function inizioGiorno_(data, spostaGiorni) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate() + (spostaGiorni || 0));
}

function formatData_(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') +
    '/' + d.getFullYear();
}

// 123456 centesimi -> "1.234,56 €"
function formatEuro_(cent) {
  const segno = cent < 0 ? '-' : '';
  const abs = Math.abs(cent);
  const euro = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return segno + euro + ',' + String(abs % 100).padStart(2, '0') + ' €';
}

// Impedisce che testo del foglio (es. "<script>") venga interpretato come HTML nella mail
function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Il log contiene solo: quando, chi, azione, conteggi. Mai importi o descrizioni.
function scriviLog_(ss, utente, azione, dettaglio) {
  let log = ss.getSheetByName(CONFIG.FOGLIO_LOG);
  if (!log) {
    log = ss.insertSheet(CONFIG.FOGLIO_LOG);
    log.appendRow(['Quando', 'Chi', 'Azione', 'Dettaglio']);
    log.setFrozenRows(1);
    log.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  log.appendRow([new Date(), utente, azione, dettaglio]);
}

// ------------------------------------------------------------ INSTALLAZIONE
// Esegui UNA volta per ricevere il report ogni lunedi' verso le 8.
function installaTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'inviaReportSettimanale')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('inviaReportSettimanale')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
}

// Crea il foglio "Spese" con dati INVENTATI (date degli ultimi giorni).
// Non sovrascrive mai un foglio che contiene gia' dati.
function generaDatiEsempio() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let f = ss.getSheetByName(CONFIG.FOGLIO_SPESE);
  if (f && f.getLastRow() > 1) {
    throw new Error('Il foglio "Spese" contiene gia\' dati: non lo sovrascrivo.');
  }
  if (!f) f = ss.insertSheet(CONFIG.FOGLIO_SPESE);
  f.clear();
  f.appendRow(['Data', 'Categoria', 'Descrizione', 'Importo']);
  f.setFrozenRows(1);
  f.getRange(1, 1, 1, 4).setFontWeight('bold');

  const esempio = [ // [giorni fa, categoria, descrizione, importo]
    [1, 'Cibo', 'Spesa supermercato', 54.30],
    [2, 'Trasporti', 'Abbonamento bus', 35.00],
    [2, 'Cibo', 'Pizzeria', 22.50],
    [3, 'Casa', 'Bolletta luce', 78.90],
    [4, 'Svago', 'Cinema', 9.00],
    [5, 'Cibo', 'Panetteria', 6.80],
    [6, 'Trasporti', 'Biglietto treno', 18.40],
    [9, 'Casa', 'Detersivi', 12.10],   // fuori dai 7 giorni: non verra' sommata
    [3, 'Svago', 'Libro', 'n/d'],      // importo non valido: verra' segnalata
  ];
  const oggi = inizioGiorno_(new Date(), 0);
  esempio.forEach(e => f.appendRow([inizioGiorno_(oggi, -e[0]), e[1], e[2], e[3]]));
  f.getRange('A:A').setNumberFormat('dd/mm/yyyy');
  f.getRange('D:D').setNumberFormat('#,##0.00');
}
